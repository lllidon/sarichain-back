import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { Connection, Types, isObjectIdOrHexString } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AccessRequest } from '../auth/access';
import { MarketplaceAccounts } from './marketplace-account.service';

const requestKinds = ['transport', 'producer'] as const;
const documentKinds = ['nationalId', 'driverLicense', 'vehicleCard', 'productionProof'] as const;

class UpgradeRequestDto {
  @IsIn(requestKinds) kind!: typeof requestKinds[number];
  @IsOptional() @IsString() @MaxLength(30) producerType?: string;
  @IsOptional() @IsArray() @IsMongoId({ each: true }) requestedCategoryIds?: string[];
  @IsArray() documents!: Array<{ type: string; fileName: string; mimeType: string; data: string }>;
}

class UpgradeReviewDto {
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

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
  async submit(@Headers('authorization') authorization: string | undefined, @Body() input: UpgradeRequestDto) {
    const member = await this.accounts.requireMember(authorization);
    if (!Array.isArray(input.documents) || input.documents.length > 6) throw new BadRequestException('تعداد مدارک نامعتبر است.');
    const required = input.kind === 'transport' ? ['nationalId', 'driverLicense', 'vehicleCard'] : ['nationalId', 'productionProof'];
    const docs = new Map<string, { type: string; fileName: string; mimeType: string; data: string }>();
    for (const doc of input.documents) {
      if (!doc || !documentKinds.includes(doc.type as typeof documentKinds[number]) ||
        typeof doc.fileName !== 'string' || doc.fileName.length > 120 ||
        !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(doc.mimeType) ||
        typeof doc.data !== 'string' || !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(doc.data) ||
        doc.data.length > 2_800_000) throw new BadRequestException('یکی از مدارک معتبر نیست یا حجم آن بیش از حد مجاز است.');
      docs.set(doc.type, doc);
    }
    if (required.some(type => !docs.has(type))) throw new BadRequestException('تمام مدارک الزامی این درخواست را بارگذاری کنید.');
    if (input.kind === 'producer') {
      if (!['orchard', 'farm', 'dairy', 'greenhouse', 'other'].includes(input.producerType || '')) throw new BadRequestException('نوع فعالیت تولیدی را انتخاب کنید.');
      if (!Array.isArray(input.requestedCategoryIds) || input.requestedCategoryIds.length < 1 || input.requestedCategoryIds.length > 20 ||
        input.requestedCategoryIds.some(id => !isObjectIdOrHexString(id))) throw new BadRequestException('حداقل یک دسته‌بندی محصول انتخاب کنید.');
    }
    const existing = await this.requests.findOne({ memberId: member._id, kind: input.kind, status: 'pending' });
    if (existing) throw new BadRequestException('برای این نوع ارتقا، درخواست در حال بررسی دارید.');
    const now = new Date();
    const record = {
      memberId: member._id, kind: input.kind, status: 'pending', documents: [...docs.values()],
      ...(input.kind === 'producer' && { producerType: input.producerType, requestedCategoryIds: [...new Set(input.requestedCategoryIds)] }),
      memberSnapshot: { fullName: member.fullName, phone: member.phone, organization: member.organization },
      createdAt: now, updatedAt: now,
    };
    const result = await this.requests.insertOne(record);
    return { id: result.insertedId, status: 'pending' };
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
    const filter = status === 'all' ? {} : { status: { $in: ['pending', 'approved', 'rejected'] }, ...(status === 'pending' ? { status: 'pending' } : { status }) };
    const rows = await this.requests.find(filter).sort({ createdAt: -1 }).limit(200).toArray();
    return { items: rows.map(row => ({ ...row, documents: (row.documents || []).map((doc: any) => ({
      type: doc.type, fileName: doc.fileName, mimeType: doc.mimeType, dataUrl: 'data:' + doc.mimeType + ';base64,' + doc.data,
    })) })) };
  }

  @Patch('members/account-upgrades/:id/review')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  async review(@Req() request: AccessRequest, @Param('id') id: string, @Body() input: UpgradeReviewDto) {
    if (!['management', 'admin'].includes(request.access.role)) throw new BadRequestException('دسترسی مدیریت لازم است.');
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه درخواست معتبر نیست.');
    const row = await this.requests.findOne({ _id: new Types.ObjectId(id), status: 'pending' });
    if (!row) throw new BadRequestException('این درخواست قبلاً بررسی شده یا وجود ندارد.');
    const now = new Date();
    if (input.status === 'approved') {
      if (row.kind === 'transport') {
        await this.members.updateOne({ _id: row.memberId }, {
          $addToSet: { serviceTypes: 'driver' },
          $set: { driverReview: { status: 'approved', reviewedAt: now, reviewedBy: String(request.userId) }, updatedAt: now },
        });
      } else {
        const categories = Array.isArray(row.requestedCategoryIds) ? row.requestedCategoryIds : [];
        if (!categories.length) throw new BadRequestException('درخواست تولیدکننده دسته‌بندی مجاز ندارد.');
        await this.members.updateOne({ _id: row.memberId }, {
          $set: { producerType: row.producerType, sellerReview: { status: 'approved', reviewedAt: now, reviewedBy: String(request.userId) },
            allowedProductCategoryIds: categories, updatedAt: now },
        });
      }
    }
    await this.requests.updateOne({ _id: row._id, status: 'pending' }, {
      $set: { status: input.status, reviewNote: input.note?.trim() || '', reviewedAt: now, reviewedBy: String(request.userId), updatedAt: now },
    });
    return { id, status: input.status };
  }
}
