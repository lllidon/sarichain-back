import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo, Types, isObjectIdOrHexString } from 'mongoose';
import { KarshaLedgerService } from '../members/karsha-ledger.service';
import { maxUploadImageBytes, prepareUploadedImage } from '../catalog/image-processing';

const locationTypes = ['orchard', 'farmland', 'greenhouse', 'nursery'] as const;
const specialties = [...locationTypes, 'crop_quality', 'all-crops'] as const;
const activeAssignmentStates = ['offered', 'accepted', 'report_submitted'];
const earthRadiusKm = 6371.0088;

type Coordinates = { latitude: number; longitude: number };
type ProductionLocation = Coordinates & {
  type: typeof locationTypes[number];
  city?: string;
  province?: string;
};
type InspectionPolicyDocument = { _id: string; [key: string]: any };
const validCoordinates = (value: any): value is Coordinates =>
  value && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
  Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180;
const validProductionLocation = (value: any): value is ProductionLocation =>
  validCoordinates(value) && locationTypes.includes(value.type);

function distanceKm(a: Coordinates, b: Coordinates) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

const cleanText = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

@Injectable()
export class InspectionsService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly karsha: KarshaLedgerService,
  ) {}

  private get db() {
    if (!this.connection.db) throw new Error('MongoDB is not connected.');
    return this.connection.db;
  }
  private get profiles() { return this.db.collection('inspection_inspector_profiles'); }
  private get requests() { return this.db.collection('inspection_requests'); }
  private get assignments() { return this.db.collection('inspection_assignments'); }
  private get reports() { return this.db.collection('inspection_reports'); }
  private get photos() { return this.db.collection('inspection_report_photos'); }
  private get locations() { return this.db.collection('web_workspace_entries'); }
  private get members() { return this.db.collection('members'); }
  private get policies() { return this.db.collection<InspectionPolicyDocument>('inspection_policies'); }

  async onModuleInit() {
    await Promise.all([
      this.profiles.createIndex({ memberId: 1 }, { unique: true, name: 'uniq_inspector_member' }),
      this.profiles.createIndex({ status: 1, specialties: 1, 'baseLocation.latitude': 1, 'baseLocation.longitude': 1 }),
      this.requests.createIndex({ producerMemberId: 1, createdAt: -1 }),
      this.requests.createIndex({ status: 1, createdAt: -1 }),
      this.assignments.createIndex({ inspectorMemberId: 1, status: 1, createdAt: -1 }),
      this.assignments.createIndex({ requestId: 1, status: 1 }),
      this.reports.createIndex({ requestId: 1, createdAt: -1 }),
      this.photos.createIndex({ reportId: 1 }),
    ]);
  }

  private async policy() {
    await this.policies.updateOne({ _id: 'default' }, {
      $setOnInsert: {
        _id: 'default', baseKarsha: 3, perHectareKarsha: 1.5, perThousandKgKarsha: 0.25,
        typeMultipliers: { orchard: 1.15, farmland: 1, greenhouse: 1.3, nursery: 1.1 },
        historyMultiplier: 1.05, varietyMultiplier: 0.02,
        maxActiveAssignments: 4, nearestPoolSize: 5, offerMinutes: 90, updatedAt: new Date(),
      },
    }, { upsert: true });
    return (await this.policies.findOne({ _id: 'default' }))!;
  }

  private async snapshot(memberId: Types.ObjectId) {
    const member = await this.members.findOne({ _id: memberId }, {
      projection: { fullName: 1, phone: 1, organization: 1, province: 1, city: 1 },
    });
    return member ? {
      fullName: member.fullName || 'عضو ساری‌چین', phone: member.phone,
      organization: member.organization, province: member.province, city: member.city,
    } : {};
  }

  async overview(memberId: Types.ObjectId) {
    await this.expireOffers();
    const [profile, locations, requests, assignments] = await Promise.all([
      this.profiles.findOne({ memberId }),
      this.locations.find({ section: 'orchards', memberId }, {
        projection: { title: 1, location: 1, createdAt: 1 },
      }).sort({ createdAt: -1 }).limit(100).toArray(),
      this.requests.find({ producerMemberId: memberId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.assignments.find({ inspectorMemberId: memberId, status: { $in: activeAssignmentStates } })
        .sort({ createdAt: -1 }).limit(50).toArray(),
    ]);
    const requestIds = assignments.map(row => row.requestId);
    const assignedRequests = requestIds.length
      ? await this.requests.find({ _id: { $in: requestIds } }).toArray() : [];
    const byId = new Map(assignedRequests.map(row => [String(row._id), row]));
    let nearbyLocations: Array<Record<string, any>> = [];
    if (profile?.status === 'approved') {
      const candidates = await this.locations.find({
        section: 'orchards', memberId: { $ne: memberId },
      }, { projection: { title: 1, location: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(2000).toArray();
      const eligibleSites: Array<{ row: any; location: ProductionLocation; distance: number }> = [];
      for (const row of candidates) {
        const location = row.location;
        if (!validProductionLocation(location)) continue;
        const productionLocation = location;
        const matchesSpecialty = profile.specialties?.includes('all-crops') ||
          profile.specialties?.includes('crop_quality') ||
          profile.specialties?.includes(productionLocation.type);
        if (!matchesSpecialty) continue;
        const distance = distanceKm(profile.baseLocation, productionLocation);
        if (distance <= Number(profile.serviceRadiusKm || 0)) {
          eligibleSites.push({ row, location: productionLocation, distance });
        }
      }
      nearbyLocations = eligibleSites
        .sort((a, b) => a.distance - b.distance).slice(0, 50)
        .map(({ row, location, distance }) => ({
          id: String(row._id), title: row.title, type: location.type,
          city: location.city, province: location.province,
          latitude: location.latitude, longitude: location.longitude,
          distanceKm: Math.round(distance * 10) / 10,
        }));
    }
    return {
      inspectorProfile: profile ? {
        status: profile.status, specialties: profile.specialties, serviceRadiusKm: profile.serviceRadiusKm,
        baseLocation: profile.baseLocation, biography: profile.biography, reviewNote: profile.reviewNote,
      } : null,
      nearbyLocations,
      locations: locations.map(row => ({
        id: String(row._id), title: row.title, type: row.location?.type,
        city: row.location?.city, province: row.location?.province,
        latitude: row.location?.latitude, longitude: row.location?.longitude,
      })),
      requests: requests.map(row => this.publicRequest(row)),
      assignments: assignments.map(row => ({
        id: String(row._id), status: row.status, offeredAt: row.offeredAt, expiresAt: row.expiresAt,
        request: this.publicRequest(byId.get(String(row.requestId))),
      })),
    };
  }

  private publicRequest(row: any) {
    if (!row) return null;
    return {
      id: String(row._id), status: row.status, locationId: String(row.locationId),
      locationTitle: row.locationTitle, location: row.location, locationDetails: row.locationDetails,
      producer: row.producerSnapshot, acreage: row.acreage,
      inspectionType: row.inspectionType, cropType: row.cropType, varieties: row.varieties,
      expectedProductionKg: row.expectedProductionKg, previousProductionKg: row.previousProductionKg,
      pesticideNotes: row.pesticideNotes, fertilizerNotes: row.fertilizerNotes, notes: row.notes,
      availability: row.availability, rewardKarsha: row.rewardKarsha, createdAt: row.createdAt,
      assignmentId: row.assignmentId ? String(row.assignmentId) : undefined,
      scheduledVisit: row.scheduledVisit,
      reportId: row.reportId ? String(row.reportId) : undefined,
      reviewNote: row.reviewNote,
    };
  }

  async submitApplication(memberId: Types.ObjectId, input: Record<string, any>) {
    if (!Array.isArray(input.specialties) || !input.specialties.length || input.specialties.length > 6 ||
      input.specialties.some((item: unknown) => typeof item !== 'string' || !specialties.includes(item as typeof specialties[number]))) {
      throw new BadRequestException('حداقل یک تخصص معتبر برای نظارت انتخاب کنید.');
    }
    const baseLocation = {
      latitude: Number(input.latitude), longitude: Number(input.longitude),
    };
    if (!validCoordinates(baseLocation)) throw new BadRequestException('مختصات پایگاه فعالیت ناظر معتبر نیست.');
    const serviceRadiusKm = Number(input.serviceRadiusKm);
    if (!Number.isFinite(serviceRadiusKm) || serviceRadiusKm < 1 || serviceRadiusKm > 300) {
      throw new BadRequestException('شعاع فعالیت باید بین ۱ تا ۳۰۰ کیلومتر باشد.');
    }
    const biography = cleanText(input.biography, 1000);
    const existing = await this.profiles.findOne({ memberId });
    if (existing?.status === 'approved') throw new ConflictException('صلاحیت نظارت شما قبلاً تأیید شده است.');
    const now = new Date();
    await this.profiles.updateOne({ memberId }, {
      $set: {
        memberId, specialties: [...new Set(input.specialties)], baseLocation, serviceRadiusKm,
        biography, status: 'pending', submittedAt: now, updatedAt: now,
        ...(existing?.status === 'rejected' ? { reviewNote: '' } : {}),
      },
      $setOnInsert: { createdAt: now },
    }, { upsert: true });
    return { status: 'pending' };
  }

  async submitRequest(memberId: Types.ObjectId, input: Record<string, any>) {
    if (!isObjectIdOrHexString(input.locationId)) throw new BadRequestException('موقعیت تولیدی را انتخاب کنید.');
    const location = await this.locations.findOne({
      _id: new Types.ObjectId(input.locationId), section: 'orchards', memberId,
    });
    if (!location?.location || !validCoordinates(location.location)) {
      throw new BadRequestException('موقعیت انتخاب‌شده فاقد مختصات معتبر است.');
    }
    const acreage = Number(input.acreage);
    if (!Number.isFinite(acreage) || acreage <= 0 || acreage > 100000) throw new BadRequestException('مساحت باید عددی مثبت بر حسب هکتار باشد.');
    const inspectionType = input.inspectionType;
    if (typeof inspectionType !== 'string' || !locationTypes.includes(inspectionType as typeof locationTypes[number])) {
      throw new BadRequestException('نوع محل تولید برای نظارت معتبر نیست.');
    }
    if (!Array.isArray(input.availability) || !input.availability.length || input.availability.length > 3 ||
      input.availability.some((slot: any) => !slot || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date || '') ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime || '') ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.endTime || '') || slot.endTime <= slot.startTime ||
        slot.date < new Date().toISOString().slice(0, 10))) {
      throw new BadRequestException('حداقل یک بازه بازدید معتبر در آینده ثبت کنید.');
    }
    const expectedProductionKg = input.expectedProductionKg === '' || input.expectedProductionKg == null ? null : Number(input.expectedProductionKg);
    const previousProductionKg = input.previousProductionKg === '' || input.previousProductionKg == null ? null : Number(input.previousProductionKg);
    for (const value of [expectedProductionKg, previousProductionKg]) {
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000_000)) {
        throw new BadRequestException('حجم تولید باید صفر یا عددی مثبت بر حسب کیلوگرم باشد.');
      }
    }
    const policy = await this.policy();
    const historyProductionKg = Math.max(expectedProductionKg || 0, previousProductionKg || 0);
    const varietyCount = cleanText(input.varieties, 300).split(/[،,؛;]/).map((item: string) => item.trim()).filter(Boolean).length;
    const typeMultiplier = Number(policy.typeMultipliers?.[inspectionType] || 1);
    const historyMultiplier = previousProductionKg ? Number(policy.historyMultiplier || 1) : 1;
    const varietyMultiplier = 1 + Math.min(5, varietyCount) * Number(policy.varietyMultiplier || 0);
    const rewardKarsha = Math.round((Number(policy.baseKarsha) + acreage * Number(policy.perHectareKarsha) +
      historyProductionKg / 1000 * Number(policy.perThousandKgKarsha)) * typeMultiplier * historyMultiplier * varietyMultiplier * 100000000) / 100000000;
    const now = new Date();
    const document = {
      producerMemberId: memberId, producerSnapshot: await this.snapshot(memberId),
      locationId: location._id, locationTitle: location.title, locationDetails: location.details || '',
      location: location.location, acreage, inspectionType,
      cropType: cleanText(input.cropType, 100), varieties: cleanText(input.varieties, 300),
      expectedProductionKg, previousProductionKg,
      pesticideNotes: cleanText(input.pesticideNotes, 1000),
      fertilizerNotes: cleanText(input.fertilizerNotes, 1000), notes: cleanText(input.notes, 1500),
      availability: input.availability.map((slot: any) => ({
        date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
      })),
      rewardKarsha, status: 'awaiting_inspector', createdAt: now, updatedAt: now,
      assignmentAttempts: 0, rejectedInspectorIds: [],
    };
    const result = await this.requests.insertOne(document);
    const request = { ...document, _id: result.insertedId };
    await this.assignNext(request);
    return this.publicRequest(await this.requests.findOne({ _id: result.insertedId }));
  }

  private async assignNext(request: any) {
    const policy = await this.policy();
    const rejected = (request.rejectedInspectorIds || []).map((id: any) => new Types.ObjectId(id));
    const profiles = await this.profiles.find({
      status: 'approved', isActive: { $ne: false }, memberId: { $nin: [request.producerMemberId, ...rejected] },
      specialties: { $in: [request.inspectionType, 'all-crops', 'crop_quality'] },
    }).toArray();
    const eligible: Array<{ profile: any; distance: number; activeCount: number; weight: number }> = [];
    for (const profile of profiles) {
      if (!validCoordinates(profile.baseLocation)) continue;
      const distance = distanceKm(request.location, profile.baseLocation);
      if (distance > Number(profile.serviceRadiusKm || 0)) continue;
      const activeCount = await this.assignments.countDocuments({
        inspectorMemberId: profile.memberId, status: { $in: activeAssignmentStates },
      });
      if (activeCount >= Number(policy.maxActiveAssignments)) continue;
      eligible.push({ profile, distance, activeCount, weight: 1 / (1 + distance) / (1 + activeCount) });
    }
    if (!eligible.length) {
      await this.requests.updateOne({ _id: request._id }, {
        $set: { status: 'awaiting_inspector', updatedAt: new Date() }, $unset: { assignmentId: '' },
      });
      return null;
    }
    eligible.sort((a, b) => a.distance - b.distance);
    const pool = eligible.slice(0, Math.max(1, Math.min(10, Number(policy.nearestPoolSize) || 5)));
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let needle = Math.random() * totalWeight;
    let chosen = pool[pool.length - 1];
    for (const item of pool) {
      needle -= item.weight;
      if (needle <= 0) { chosen = item; break; }
    }
    const now = new Date();
    const assignment = await this.assignments.insertOne({
      requestId: request._id, inspectorMemberId: chosen.profile.memberId,
      status: 'offered', distanceKm: Math.round(chosen.distance * 10) / 10,
      offeredAt: now, expiresAt: new Date(now.getTime() + Number(policy.offerMinutes) * 60_000), createdAt: now,
    });
    await this.requests.updateOne({ _id: request._id }, {
      $set: { status: 'offered', assignmentId: assignment.insertedId, assignedInspectorId: chosen.profile.memberId, updatedAt: now },
      $inc: { assignmentAttempts: 1 },
    });
    return assignment.insertedId;
  }

  private async expireOffers() {
    const expired = await this.assignments.find({ status: 'offered', expiresAt: { $lte: new Date() } }).limit(100).toArray();
    for (const assignment of expired) {
      const changed = await this.assignments.updateOne({ _id: assignment._id, status: 'offered' }, {
        $set: { status: 'expired', closedAt: new Date() },
      });
      if (!changed.modifiedCount) continue;
      const request = await this.requests.findOne({ _id: assignment.requestId });
      if (!request || request.status !== 'offered') continue;
      await this.requests.updateOne({ _id: request._id }, {
        $addToSet: { rejectedInspectorIds: assignment.inspectorMemberId },
        $set: { status: 'awaiting_inspector', updatedAt: new Date() }, $unset: { assignmentId: '', assignedInspectorId: '' },
      });
      await this.assignNext({ ...request, rejectedInspectorIds: [...(request.rejectedInspectorIds || []), assignment.inspectorMemberId] });
    }
  }

  async decideAssignment(memberId: Types.ObjectId, assignmentId: string, decision: unknown, availabilityIndex: unknown) {
    if (!isObjectIdOrHexString(assignmentId) || !['accept', 'decline'].includes(String(decision))) {
      throw new BadRequestException('تصمیم یا شناسه مأموریت معتبر نیست.');
    }
    await this.expireOffers();
    const assignment = await this.assignments.findOne({
      _id: new Types.ObjectId(assignmentId), inspectorMemberId: memberId, status: 'offered',
    });
    if (!assignment) throw new NotFoundException('این مأموریت دیگر در دسترس شما نیست.');
    const request = await this.requests.findOne({ _id: assignment.requestId });
    if (!request) throw new NotFoundException('درخواست نظارت پیدا نشد.');
    const now = new Date();
    if (decision === 'decline') {
      await this.assignments.updateOne({ _id: assignment._id, status: 'offered' }, { $set: { status: 'declined', closedAt: now } });
      await this.requests.updateOne({ _id: request._id }, {
        $addToSet: { rejectedInspectorIds: memberId },
        $set: { status: 'awaiting_inspector', updatedAt: now }, $unset: { assignmentId: '', assignedInspectorId: '' },
      });
      await this.assignNext({ ...request, rejectedInspectorIds: [...(request.rejectedInspectorIds || []), memberId] });
      return { status: 'declined' };
    }
    const inspectorProfile = await this.profiles.findOne({ memberId, status: 'approved' });
    if (!inspectorProfile) throw new ConflictException('صلاحیت نظارت شما فعال نیست.');
    const index = Number(availabilityIndex);
    if (!Number.isInteger(index) || index < 0 || index >= request.availability.length) {
      throw new BadRequestException('بازه پیشنهادی بازدید را انتخاب کنید.');
    }
    const selected = request.availability[index];
    const sameDay = await this.assignments.find({
      inspectorMemberId: memberId, status: 'accepted', 'selectedAvailability.date': selected.date,
    }).toArray();
    const overlaps = sameDay.some(row => {
      const slot = row.selectedAvailability;
      return slot && selected.startTime < slot.endTime && selected.endTime > slot.startTime;
    });
    if (overlaps) throw new ConflictException('در این بازه زمانی مأموریت دیگری پذیرفته‌اید؛ زمان دیگری را انتخاب کنید.');
    await this.assignments.updateOne({ _id: assignment._id, status: 'offered' }, {
      $set: { status: 'accepted', acceptedAt: now, selectedAvailability: selected },
    });
    await this.requests.updateOne({ _id: request._id }, {
      $set: { status: 'scheduled', scheduledVisit: selected, updatedAt: now },
    });
    return { status: 'accepted', scheduledVisit: request.availability[index] };
  }

  async submitReport(memberId: Types.ObjectId, assignmentId: string, body: Record<string, any>, files: Array<{ buffer: Buffer; mimetype: string }> = []) {
    if (!isObjectIdOrHexString(assignmentId)) throw new BadRequestException('شناسه مأموریت معتبر نیست.');
    const assignment = await this.assignments.findOne({
      _id: new Types.ObjectId(assignmentId), inspectorMemberId: memberId, status: 'accepted',
    });
    if (!assignment) throw new NotFoundException('ابتدا مأموریت را بپذیرید یا وضعیت آن تغییر کرده است.');
    if (files.length > 8 || files.some(file => !file.buffer || file.buffer.length > maxUploadImageBytes)) {
      throw new BadRequestException('حداکثر ۸ تصویر و حجم مجاز هر تصویر را رعایت کنید.');
    }
    const qualityScore = Number(body.qualityScore);
    if (!Number.isInteger(qualityScore) || qualityScore < 1 || qualityScore > 5) {
      throw new BadRequestException('امتیاز کیفیت باید بین ۱ تا ۵ باشد.');
    }
    const qualityGrade = body.qualityGrade;
    if (!['A', 'B', 'C', 'reject'].includes(qualityGrade)) throw new BadRequestException('درجه کیفی معتبر نیست.');
    const request = await this.requests.findOne({ _id: assignment.requestId });
    if (!request) throw new NotFoundException('درخواست نظارت پیدا نشد.');
    const observations = cleanText(body.observations, 2000);
    if (!observations) throw new BadRequestException('شرح مشاهدات بازدید الزامی است.');
    const report = {
      requestId: request._id, assignmentId: assignment._id, inspectorMemberId: memberId,
      producerMemberId: request.producerMemberId, qualityScore, qualityGrade,
      observations,
      pesticideAssessment: cleanText(body.pesticideAssessment, 1500),
      fertilizerAssessment: cleanText(body.fertilizerAssessment, 1500),
      recommendations: cleanText(body.recommendations, 2000),
      estimatedYieldKg: body.estimatedYieldKg === '' || body.estimatedYieldKg == null ? null : Number(body.estimatedYieldKg),
      status: 'pending_review', createdAt: new Date(),
    };
    if (report.estimatedYieldKg !== null && (!Number.isFinite(report.estimatedYieldKg) || report.estimatedYieldKg < 0 || report.estimatedYieldKg > 1_000_000_000)) {
      throw new BadRequestException('برآورد تولید باید عددی معتبر بر حسب کیلوگرم باشد.');
    }
    const preparedImages = await Promise.all(files.map(file => prepareUploadedImage(file.buffer)));
    const result = await this.reports.insertOne(report);
    const photoIds: Types.ObjectId[] = [];
    for (const image of preparedImages) {
      const photo = await this.photos.insertOne({
        reportId: result.insertedId, data: new mongo.Binary(image.data), mimeType: image.type, createdAt: new Date(),
      });
      photoIds.push(photo.insertedId);
    }
    await this.reports.updateOne({ _id: result.insertedId }, { $set: { photoIds } });
    await this.assignments.updateOne({ _id: assignment._id }, { $set: { status: 'report_submitted', reportId: result.insertedId, reportSubmittedAt: new Date() } });
    await this.requests.updateOne({ _id: request._id }, { $set: { status: 'pending_review', reportId: result.insertedId, updatedAt: new Date() } });
    return { id: String(result.insertedId), status: 'pending_review', photoCount: photoIds.length };
  }

  async readPhoto(memberId: Types.ObjectId, reportId: string, photoId: string) {
    if (!isObjectIdOrHexString(reportId) || !isObjectIdOrHexString(photoId)) throw new NotFoundException();
    const report = await this.reports.findOne({
      _id: new Types.ObjectId(reportId), $or: [{ producerMemberId: memberId }, { inspectorMemberId: memberId }],
    });
    if (!report) throw new NotFoundException();
    const photo = await this.photos.findOne({ _id: new Types.ObjectId(photoId), reportId: report._id });
    if (!photo?.data || !photo.mimeType) throw new NotFoundException();
    return { buffer: photo.data.value(), mimeType: photo.mimeType };
  }

  async adminOverview() {
    const [applications, requests, reports, sites] = await Promise.all([
      this.profiles.find({ status: 'pending' }).sort({ submittedAt: 1 }).limit(100).toArray(),
      this.requests.find({}).sort({ createdAt: -1 }).limit(100).toArray(),
      this.reports.find({ status: 'pending_review' }).sort({ createdAt: 1 }).limit(100).toArray(),
      this.locations.find({ section: 'orchards' }, { projection: { title: 1, location: 1, memberId: 1, createdAt: 1 } })
        .sort({ createdAt: -1 }).limit(500).toArray(),
    ]);
    const memberIds = [...new Map([
      ...applications.map(row => [String(row.memberId), row.memberId] as const),
      ...requests.map(row => [String(row.producerMemberId), row.producerMemberId] as const),
      ...reports.map(row => [String(row.inspectorMemberId), row.inspectorMemberId] as const),
      ...sites.map(row => [String(row.memberId), row.memberId] as const),
    ]).values()];
    const members = memberIds.length ? await this.members.find({ _id: { $in: memberIds } }, {
      projection: { fullName: 1, phone: 1, organization: 1, city: 1, province: 1 },
    }).toArray() : [];
    const memberMap = new Map(members.map(row => [String(row._id), row]));
    const requestMap = new Map(requests.map(row => [String(row._id), row]));
    const applicationsView = applications.map(row => ({
      memberId: String(row.memberId), specialties: row.specialties, baseLocation: row.baseLocation,
      serviceRadiusKm: row.serviceRadiusKm, biography: row.biography, submittedAt: row.submittedAt,
      member: memberMap.get(String(row.memberId)),
    }));
    const reportsView = await Promise.all(reports.map(async row => {
      const photos = await this.photos.find({ reportId: row._id }).toArray();
      return {
        id: String(row._id), requestId: String(row.requestId), assignmentId: String(row.assignmentId),
        inspectorMemberId: String(row.inspectorMemberId), qualityScore: row.qualityScore,
        qualityGrade: row.qualityGrade, observations: row.observations,
        pesticideAssessment: row.pesticideAssessment, fertilizerAssessment: row.fertilizerAssessment,
        recommendations: row.recommendations, estimatedYieldKg: row.estimatedYieldKg,
        photoIds: photos.map(photo => String(photo._id)),
        photos: photos.map(photo => ({
          id: String(photo._id),
          dataUrl: 'data:' + photo.mimeType + ';base64,' + photo.data.value().toString('base64'),
        })),
        createdAt: row.createdAt, inspector: memberMap.get(String(row.inspectorMemberId)),
        request: this.publicRequest(requestMap.get(String(row.requestId))),
      };
    }));
    return {
      applications: applicationsView,
      locations: sites.map(row => ({
        id: String(row._id), title: row.title, type: row.location?.type,
        city: row.location?.city, province: row.location?.province,
        latitude: row.location?.latitude, longitude: row.location?.longitude,
        producer: memberMap.get(String(row.memberId)), createdAt: row.createdAt,
      })),
      requests: requests.map(row => ({
        ...this.publicRequest(row), producerMemberId: String(row.producerMemberId),
        producer: memberMap.get(String(row.producerMemberId)),
      })),
      reports: reportsView,
    };
  }

  async reviewApplication(memberIdText: string, status: unknown, note: unknown, actor: string) {
    if (!isObjectIdOrHexString(memberIdText) || !['approved', 'rejected'].includes(String(status)) ||
      (note !== undefined && (typeof note !== 'string' || note.length > 500))) {
      throw new BadRequestException('تصمیم یا شناسه درخواست معتبر نیست.');
    }
    const memberId = new Types.ObjectId(memberIdText);
    const profile = await this.profiles.findOne({ memberId, status: 'pending' });
    if (!profile) throw new NotFoundException('درخواست ناظر در انتظار بررسی پیدا نشد.');
    const now = new Date();
    await this.profiles.updateOne({ _id: profile._id, status: 'pending' }, {
      $set: { status, reviewNote: cleanText(note, 500), reviewedAt: now, reviewedBy: actor, updatedAt: now },
    });
    if (status === 'approved') {
      const waiting = await this.requests.find({ status: 'awaiting_inspector' }).sort({ createdAt: 1 }).limit(100).toArray();
      for (const request of waiting) await this.assignNext(request);
    }
    return { memberId: memberIdText, status };
  }

  async reviewRequest(requestId: string, status: unknown, note: unknown, actor: string) {
    if (!isObjectIdOrHexString(requestId) || !['approved', 'rejected'].includes(String(status)) ||
      (note !== undefined && (typeof note !== 'string' || note.length > 500))) {
      throw new BadRequestException('تصمیم یا شناسه گزارش معتبر نیست.');
    }
    const request = await this.requests.findOne({ _id: new Types.ObjectId(requestId), status: 'pending_review' });
    if (!request?.reportId) throw new NotFoundException('گزارش در انتظار بررسی پیدا نشد.');
    const report = await this.reports.findOne({ _id: request.reportId, status: 'pending_review' });
    if (!report) throw new NotFoundException('گزارش در انتظار بررسی پیدا نشد.');
    const now = new Date();
    if (status === 'approved') {
      await this.karsha.credit(String(report.inspectorMemberId), Number(request.rewardKarsha), {
        reason: 'پاداش مأموریت نظارت تأییدشده',
        actor, idempotencyKey: 'inspection-reward:' + String(request._id), kind: 'inspection_reward',
      });
      await this.reports.updateOne({ _id: report._id, status: 'pending_review' }, {
        $set: { status: 'approved', reviewedAt: now, reviewedBy: actor, reviewNote: cleanText(note, 500) },
      });
      await this.assignments.updateOne({ _id: report.assignmentId }, { $set: { status: 'completed', completedAt: now } });
      await this.requests.updateOne({ _id: request._id, status: 'pending_review' }, {
        $set: { status: 'completed', reviewedAt: now, reviewedBy: actor, reviewNote: cleanText(note, 500), updatedAt: now },
      });
    } else {
      await this.reports.updateOne({ _id: report._id, status: 'pending_review' }, {
        $set: { status: 'rejected', reviewedAt: now, reviewedBy: actor, reviewNote: cleanText(note, 500) },
      });
      await this.assignments.updateOne({ _id: report.assignmentId }, { $set: { status: 'accepted', reviewNote: cleanText(note, 500) } });
      await this.requests.updateOne({ _id: request._id, status: 'pending_review' }, {
        $set: { status: 'revision_required', reviewNote: cleanText(note, 500), updatedAt: now },
      });
    }
    return { id: requestId, status };
  }

  async readPolicy() { return this.policy(); }

  async savePolicy(input: Record<string, any>) {
    const fields = ['baseKarsha', 'perHectareKarsha', 'perThousandKgKarsha', 'maxActiveAssignments', 'nearestPoolSize', 'offerMinutes'];
    const numeric = Object.fromEntries(fields.map(key => [key, Number(input[key])]));
    const types = ['orchard', 'farmland', 'greenhouse', 'nursery'];
    const typeMultipliers = Object.fromEntries(types.map(key => [key, Number(input.typeMultipliers?.[key])]));
    const valid = Number.isFinite(numeric.baseKarsha) && numeric.baseKarsha > 0 && numeric.baseKarsha <= 100000 &&
      Number.isFinite(numeric.perHectareKarsha) && numeric.perHectareKarsha >= 0 && numeric.perHectareKarsha <= 100000 &&
      Number.isFinite(numeric.perThousandKgKarsha) && numeric.perThousandKgKarsha >= 0 && numeric.perThousandKgKarsha <= 100000 &&
      Number.isFinite(Number(input.historyMultiplier)) && Number(input.historyMultiplier) >= 1 && Number(input.historyMultiplier) <= 3 &&
      Number.isFinite(Number(input.varietyMultiplier)) && Number(input.varietyMultiplier) >= 0 && Number(input.varietyMultiplier) <= 0.5 &&
      types.every(key => Number.isFinite(typeMultipliers[key]) && typeMultipliers[key] >= 0.5 && typeMultipliers[key] <= 3) &&
      Number.isInteger(numeric.maxActiveAssignments) && numeric.maxActiveAssignments >= 1 && numeric.maxActiveAssignments <= 50 &&
      Number.isInteger(numeric.nearestPoolSize) && numeric.nearestPoolSize >= 1 && numeric.nearestPoolSize <= 10 &&
      Number.isInteger(numeric.offerMinutes) && numeric.offerMinutes >= 5 && numeric.offerMinutes <= 1440;
    if (!valid) throw new BadRequestException('مقادیر سیاست نظارت معتبر نیستند.');
    await this.policies.updateOne({ _id: 'default' }, {
      $set: { ...numeric, typeMultipliers, historyMultiplier: Number(input.historyMultiplier),
        varietyMultiplier: Number(input.varietyMultiplier), updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    }, { upsert: true });
    return this.policy();
  }
}
