import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, ServiceUnavailableException, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Connection, Types, isObjectIdOrHexString } from 'mongoose';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AccessRequest } from '../auth/access';
import { MarketplaceAccounts } from './marketplace-account.service';
import { KarshaLedgerService } from './karsha-ledger.service';

const requestKinds = ['transport', 'producer'] as const;
const documentKinds = ['nationalId', 'driverLicense', 'vehicleCard', 'productionProof'] as const;
const uploadFields = [
  { name: 'nationalId', maxCount: 1 }, { name: 'driverLicense', maxCount: 1 },
  { name: 'vehicleCard', maxCount: 1 }, { name: 'productionProof', maxCount: 1 },
];

@ApiTags('account-upgrades')
@Controller()
export class AccountUpgradesController {
  constructor(
    private readonly accounts: MarketplaceAccounts,
    private readonly karsha: KarshaLedgerService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private get requests() { return this.connection.db!.collection('account_upgrade_requests'); }
  private get members() { return this.connection.db!.collection('members'); }

  private encryptionKey() {
    // TEMPORARY DEVELOPMENT KEY. Replace with a secret environment variable before production.
    const value = process.env.ACCOUNT_UPGRADE_ENCRYPTION_KEY || '73617269636861696e2d74656d702d6b657973617269636861696e2d74656d70';
    if (!/^[a-f0-9]{64}$/i.test(value)) {
      throw new ServiceUnavailableException('کلید رمزنگاری مدارک ارتقای حساب روی سرور تنظیم نشده است.');
    }
    return Buffer.from(value, 'hex');
  }

  private encryptDocument(data: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return { data: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
  }

  private validDocument(file: { mimetype: string; buffer: Buffer }) {
    const bytes = file.buffer;
    if (file.mimetype === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (file.mimetype === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (file.mimetype === 'application/pdf') return bytes.toString('ascii', 0, 5) === '%PDF-';
    return false;
  }

  private decryptDocument(document: { data: string; iv: string; authTag: string }) {
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(document.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(document.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(document.data, 'base64')), decipher.final()]);
  }

  @Post('web/account-upgrades')
  @ApiBearerAuth()
  @UseInterceptors(FileFieldsInterceptor(uploadFields, { limits: { fileSize: 2 * 1024 * 1024, files: 4 } }))
  async submit(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Record<string, Array<{ originalname: string; mimetype: string; buffer: Buffer }>>,
  ) {
    const member = await this.accounts.requireMember(authorization);
    const kind = body.kind;
    if (typeof kind !== 'string' || !requestKinds.includes(kind as typeof requestKinds[number])) {
      throw new BadRequestException('نوع درخواست ارتقا معتبر نیست.');
    }
    const required = kind === 'transport' ? ['nationalId', 'driverLicense', 'vehicleCard'] : ['nationalId', 'productionProof'];
    const documents: Array<{ type: string; fileName: string; mimeType: string; data: string }> = [];
    for (const type of documentKinds) {
      const file = files?.[type]?.[0];
      if (required.includes(type) && !file) throw new BadRequestException('تمام مدارک الزامی را بارگذاری کنید.');
      if (!file) continue;
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype) ||
        !file.buffer || file.buffer.length > 2 * 1024 * 1024 || !this.validDocument(file)) throw new BadRequestException('نوع یا حجم یکی از مدارک معتبر نیست.');
      documents.push({ type, fileName: file.originalname.slice(0, 120), mimeType: file.mimetype, ...this.encryptDocument(file.buffer) });
    }
    let vehicle: Record<string, unknown> | undefined;
    let producerType: string | undefined;
    let requestedCategoryIds: string[] = [];
    let requestedCategoryLabels: string[] = [];
    if (kind === 'transport') {
      try { vehicle = typeof body.vehicle === 'string' ? JSON.parse(body.vehicle) : undefined; } catch { vehicle = undefined; }
      const validTypes = ['motorcycle', 'car', 'pickup', 'van', 'truckette', 'truck'];
      if (!vehicle || typeof vehicle.type !== 'string' || !validTypes.includes(vehicle.type) ||
        typeof vehicle.model !== 'string' || vehicle.model.trim().length < 2 || vehicle.model.length > 100 ||
        !Number.isInteger(vehicle.year) || Number(vehicle.year) < 1300 || Number(vehicle.year) > 1500 ||
        !Number.isInteger(vehicle.capacityKg) || Number(vehicle.capacityKg) < 1 || Number(vehicle.capacityKg) > 100000 ||
        (vehicle.capacityM3 !== undefined && (!Number.isFinite(Number(vehicle.capacityM3)) || Number(vehicle.capacityM3) <= 0)) ||
        typeof vehicle.plate !== 'string' || vehicle.plate.trim().length < 3 || vehicle.plate.length > 40 ||
        typeof vehicle.license !== 'string' || vehicle.license.trim().length < 3 || vehicle.license.length > 80) {
        throw new BadRequestException('مشخصات وسیله نقلیه را کامل و صحیح وارد کنید.');
      }
      vehicle = { ...vehicle, model: vehicle.model.trim(), plate: vehicle.plate.trim(), license: vehicle.license.trim() };
    } else {
      producerType = typeof body.producerType === 'string' ? body.producerType : '';
      if (!['orchard', 'farm', 'dairy', 'greenhouse', 'other'].includes(producerType)) {
        throw new BadRequestException('نوع فعالیت تولیدی را انتخاب کنید.');
      }
      try {
        const raw = typeof body.requestedCategoryIds === 'string' ? JSON.parse(body.requestedCategoryIds) : [];
        if (Array.isArray(raw)) requestedCategoryIds = [...new Set(raw.filter((id): id is string => typeof id === 'string'))];
      } catch { requestedCategoryIds = []; }
      if (!requestedCategoryIds.length || requestedCategoryIds.length > 20 || requestedCategoryIds.some(id => !isObjectIdOrHexString(id))) {
        throw new BadRequestException('حداقل یک دسته‌بندی محصول معتبر انتخاب کنید.');
      }
      const categoryRows = await this.connection.db!.collection('categories').find(
        { _id: { $in: requestedCategoryIds.map(id => new Types.ObjectId(id)) } }, { projection: { name: 1 } },
      ).toArray();
      if (categoryRows.length !== requestedCategoryIds.length) throw new BadRequestException('یکی از دسته‌بندی‌های انتخاب‌شده معتبر نیست.');
      requestedCategoryLabels = categoryRows.map(row => String(row.name || ''));
    }

    await this.requests.createIndex({ memberId: 1, kind: 1 }, {
      unique: true, partialFilterExpression: { status: 'pending' }, name: 'uniq_pending_member_upgrade_kind',
    });
    if (await this.requests.findOne({ memberId: member._id, kind, status: 'pending' })) {
      throw new BadRequestException('برای این نوع ارتقا، درخواست در حال بررسی دارید.');
    }
    const now = new Date();
    const record = {
      memberId: member._id, kind, status: 'pending', documents,
      ...(kind === 'producer' && { producerType, requestedCategoryIds, requestedCategoryLabels }),
      ...(kind === 'transport' && { vehicle }),
      memberSnapshot: { fullName: member.fullName, phone: member.phone, organization: member.organization },
      createdAt: now, updatedAt: now,
    };
    try {
      const result = await this.requests.insertOne(record);
      return { id: result.insertedId, status: 'pending' };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new BadRequestException('برای این نوع ارتقا، درخواست در حال بررسی دارید.');
      }
      throw error;
    }
  }

  @Post('web/account-upgrades/producer-categories')
  @ApiBearerAuth()
  async requestProducerCategories(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { requestedCategoryIds?: unknown },
  ) {
    const member = await this.accounts.requireMember(authorization);
    if (!member.producerType || member.sellerReview?.status !== 'approved') {
      throw new BadRequestException('این امکان فقط برای حساب تولیدکننده تأییدشده فعال است.');
    }
    const raw = body.requestedCategoryIds;
    const requestedCategoryIds = Array.isArray(raw)
      ? [...new Set(raw.filter((id): id is string => typeof id === 'string'))]
      : [];
    if (!requestedCategoryIds.length || requestedCategoryIds.length > 20 ||
      requestedCategoryIds.some(id => !isObjectIdOrHexString(id))) {
      throw new BadRequestException('حداقل یک دسته‌بندی معتبر انتخاب کنید.');
    }
    const categoryRows = await this.connection.db!.collection('categories').find(
      { _id: { $in: requestedCategoryIds.map(id => new Types.ObjectId(id)) } },
      { projection: { name: 1 } },
    ).toArray();
    if (categoryRows.length !== requestedCategoryIds.length) {
      throw new BadRequestException('یکی از دسته‌بندی‌های انتخاب‌شده معتبر نیست.');
    }
    const currentCategoryIds = (member.allowedProductCategoryIds || []).map((id: Types.ObjectId | string) => String(id));
    if (currentCategoryIds.length === requestedCategoryIds.length &&
      currentCategoryIds.every((id: string) => requestedCategoryIds.includes(id))) {
      throw new BadRequestException('دسته‌بندی‌های انتخاب‌شده با مجوز فعلی تفاوتی ندارند.');
    }
    const currentRows = currentCategoryIds.length
      ? await this.connection.db!.collection('categories').find(
        { _id: { $in: currentCategoryIds.map((id: string) => new Types.ObjectId(id)) } },
        { projection: { name: 1 } },
      ).toArray()
      : [];
    await this.requests.createIndex({ memberId: 1, kind: 1 }, {
      unique: true, partialFilterExpression: { status: 'pending' },
      name: 'uniq_pending_member_upgrade_kind',
    });
    const now = new Date();
    try {
      const result = await this.requests.insertOne({
        memberId: member._id, kind: 'producer_categories', status: 'pending', documents: [],
        currentCategoryIds, currentCategoryLabels: currentRows.map(row => String(row.name || '')),
        requestedCategoryIds, requestedCategoryLabels: categoryRows.map(row => String(row.name || '')),
        memberSnapshot: { fullName: member.fullName, phone: member.phone, organization: member.organization },
        createdAt: now, updatedAt: now,
      });
      return { id: result.insertedId, status: 'pending' };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new BadRequestException('درخواست تغییر دسته‌بندی شما در انتظار بررسی است.');
      }
      throw error;
    }
  }

  @Get('web/account-upgrades')
  @ApiBearerAuth()
  async own(@Headers('authorization') authorization?: string) {
    const member = await this.accounts.requireMember(authorization);
    const rows = await this.requests.find({ memberId: member._id }, { projection: { documents: 0 } })
      .sort({ createdAt: -1 }).limit(20).toArray();
    return { items: rows };
  }

  @Get('members/account-upgrades/requests')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  async list(@Req() request: AccessRequest) {
    if (!['management', 'admin'].includes(request.access.role)) throw new BadRequestException('دسترسی مدیریت لازم است.');
    const rows = await this.requests.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(200).toArray();
    return { items: rows.map(row => ({ ...row, documents: (row.documents || []).map((doc: any) => ({
      type: doc.type, fileName: doc.fileName, mimeType: doc.mimeType,
      dataUrl: 'data:' + doc.mimeType + ';base64,' + this.decryptDocument(doc).toString('base64'),
    })) })) };
  }

  @Patch('members/account-upgrades/:id/review')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  async review(@Req() request: AccessRequest, @Param('id') id: string, @Body() input: { status?: string; note?: string }) {
    if (!['management', 'admin'].includes(request.access.role)) throw new BadRequestException('دسترسی مدیریت لازم است.');
    if (!isObjectIdOrHexString(id) || !['approved', 'rejected'].includes(input.status || '') ||
      (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))) {
      throw new BadRequestException('تصمیم یا شناسه درخواست معتبر نیست.');
    }
    const row = await this.requests.findOne({ _id: new Types.ObjectId(id), status: 'pending' });
    if (!row) throw new BadRequestException('این درخواست قبلاً بررسی شده یا وجود ندارد.');
    const now = new Date();
    if (input.status === 'approved') {
      if (row.kind === 'transport') {
        await this.connection.db!.collection('member_vehicles').updateOne({ memberId: row.memberId }, {
          $set: { ...row.vehicle, memberId: row.memberId, updatedAt: now }, $setOnInsert: { createdAt: now },
        }, { upsert: true });
        await this.members.updateOne({ _id: row.memberId }, {
          $addToSet: { serviceTypes: 'driver' },
          $set: { vehicle: { type: row.vehicle.type, plate: row.vehicle.plate, license: row.vehicle.license },
            driverReview: { status: 'approved', reviewedAt: now, reviewedBy: request.userId }, updatedAt: now },
        });
      } else if (row.kind === 'producer_categories') {
        const categories = Array.isArray(row.requestedCategoryIds) ? row.requestedCategoryIds : [];
        if (!categories.length) throw new BadRequestException('درخواست تغییر دسته‌بندی فاقد دسته‌بندی معتبر است.');
        await this.members.updateOne({ _id: row.memberId, 'sellerReview.status': 'approved' }, {
          $set: { allowedProductCategoryIds: categories.map((id: string) => new Types.ObjectId(id)), updatedAt: now },
        });
      } else {
        const categories = Array.isArray(row.requestedCategoryIds) ? row.requestedCategoryIds : [];
        if (!categories.length) throw new BadRequestException('درخواست تولیدکننده دسته‌بندی مجاز ندارد.');
        await this.members.updateOne({ _id: row.memberId }, {
          $set: { producerType: row.producerType, sellerReview: { status: 'approved', reviewedAt: now, reviewedBy: request.userId },
            allowedProductCategoryIds: categories.map((id: string) => new Types.ObjectId(id)), updatedAt: now },
        });
      }
    }
    if (input.status === 'approved' && row.kind !== 'producer_categories') {
      // Award the one-time customer onboarding credit after the first document review approval.
      await this.karsha.credit(row.memberId.toString(), 1, {
        reason: 'هدیه تکمیل و تأیید مدارک حساب',
        actor: request.userId,
        idempotencyKey: 'onboarding:' + row.memberId.toString(),
        kind: 'onboarding',
        markOnboarding: true,
      });
    }
    await this.requests.updateOne({ _id: row._id, status: 'pending' }, {
      $set: { status: input.status, reviewNote: input.note?.trim() || '', reviewedAt: now, reviewedBy: request.userId, updatedAt: now },
    });
    return { id, status: input.status };
  }
}
