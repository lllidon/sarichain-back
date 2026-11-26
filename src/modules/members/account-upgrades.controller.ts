import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Connection, Types, isObjectIdOrHexString } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AccessRequest } from '../auth/access';
import { MarketplaceAccounts } from './marketplace-account.service';

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
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private get requests() { return this.connection.db!.collection('account_upgrade_requests'); }
  private get members() { return this.connection.db!.collection('members'); }

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
    const documents: Array<{ type: string; fileName: string; mimeType: string; data: Buffer }> = [];
    for (const type of documentKinds) {
      const file = files?.[type]?.[0];
      if (required.includes(type) && !file) throw new BadRequestException('تمام مدارک الزامی را بارگذاری کنید.');
      if (!file) continue;
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype) ||
        !file.buffer || file.buffer.length > 2 * 1024 * 1024) throw new BadRequestException('نوع یا حجم یکی از مدارک معتبر نیست.');
      documents.push({ type, fileName: file.originalname.slice(0, 120), mimeType: file.mimetype, data: file.buffer });
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

  @Get('web/account-upgrades')
  @ApiBearerAuth()
  async own(@Headers('authorization') authorization?: string) {
    const member = await this.accounts.requireMember(authorization);
    const rows = await this.requests.find({ memberId: member._id }, { projection: { documents: 0 } })
      .sort({ createdAt: -1 }).limit(20).toArray();
    return { items: rows };
  }

  @Get('members/account-upgrades')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  async list(@Req() request: AccessRequest, @Query('status') status = 'pending') {
    if (!['management', 'admin'].includes(request.access.role)) throw new BadRequestException('دسترسی مدیریت لازم است.');
    const filter = status === 'all' ? {} : { status: 'pending' };
    const rows = await this.requests.find(filter).sort({ createdAt: -1 }).limit(200).toArray();
    return { items: rows.map(row => ({ ...row, documents: (row.documents || []).map((doc: any) => ({
      type: doc.type, fileName: doc.fileName, mimeType: doc.mimeType,
      dataUrl: 'data:' + doc.mimeType + ';base64,' + (Buffer.isBuffer(doc.data) ? doc.data.toString('base64') : String(doc.data || '')),
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
      } else {
        const categories = Array.isArray(row.requestedCategoryIds) ? row.requestedCategoryIds : [];
        if (!categories.length) throw new BadRequestException('درخواست تولیدکننده دسته‌بندی مجاز ندارد.');
        await this.members.updateOne({ _id: row.memberId }, {
          $set: { producerType: row.producerType, sellerReview: { status: 'approved', reviewedAt: now, reviewedBy: request.userId },
            allowedProductCategoryIds: categories, updatedAt: now },
        });
      }
    }
    await this.requests.updateOne({ _id: row._id, status: 'pending' }, {
      $set: { status: input.status, reviewNote: input.note?.trim() || '', reviewedAt: now, reviewedBy: request.userId, updatedAt: now },
    });
    return { id, status: input.status };
  }
}
