import { BadRequestException, Body, ConflictException, Controller, Get, Header, NotFoundException, Param, ParseEnumPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsMongoId, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Connection, Types, isObjectIdOrHexString, Model } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AllowClient, type AccessRequest } from '../auth/access';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { Branch, BranchOrder, Profile } from './organization.schemas';
import { TransportZoneTariffsDto, TransportZoneTariffRecord, defaultTransportZoneTariffs, zoneDefinitions, speedDefinitions, findEligibleTransportCarriers, quoteTransportOrder } from '../members/transport-orders';

enum SettingsList {
  Branches = 'branches',
  Profiles = 'profiles',
}

class TransportOrderReviewDto {
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';
  @IsOptional() @IsArray() @ArrayMaxSize(2) @ArrayUnique() @IsMongoId({ each: true }) specialCarrierIds?: string[];
}

class SettingsInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(140) name?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/i) code?: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
}

@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('organization')
export class OrganizationController {
  constructor(
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(BranchOrder.name) private readonly orders: Model<BranchOrder>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  @Get('transport-orders')
  @UseGuards(AdminGuard)
  @Header('Cache-Control', 'private, no-store')
  async listTransportOrders(@Query() { page, limit, search }: CatalogQueryDto) {
    const escaped = [...(search ?? '').trim()].map(char => '.^$*+?()[]{}|\\'.includes(char) ? '\\' + char : char).join('');
    const filter = escaped ? { $or: [{ goodsType: new RegExp(escaped, 'i') }, { 'customer.fullName': new RegExp(escaped, 'i') }, { 'customer.phone': new RegExp(escaped, 'i') }] } : {};
    const orders = this.connection.db!.collection('transport_orders');
    const [items, total] = await Promise.all([
      orders.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      orders.countDocuments(filter),
    ]);
    const zoneTariffs = await this.readZoneTariffs();
    const enriched = await Promise.all(items.map(async order => ({
      ...order,
      ...(order.status === 'pending_review' || order.status === 'approved' ? {
        quote: await quoteTransportOrder(order.stops, order.weightKg, order.volumeM3, order.urgency, zoneTariffs),
        candidates: await findEligibleTransportCarriers(this.connection.db!, order.weightKg, order.volumeM3, order.stops, zoneTariffs.densityKgPerM3),
      } : { candidates: [] }),
    })));
    return { items: enriched, total, page, limit };
  }

  @Patch('transport-orders/:id')
  @UseGuards(AdminGuard)
  async reviewTransportOrder(@Param('id') id: string, @Body() input: TransportOrderReviewDto) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه سفارش معتبر نیست.');
    const orders = this.connection.db!.collection('transport_orders');
    const order = await orders.findOne({ _id: new Types.ObjectId(id) });
    if (!order) throw new NotFoundException('سفارش حمل پیدا نشد.');
    if (order.status !== 'pending_review' && order.status !== 'approved') throw new ConflictException('وضعیت این سفارش قابل بررسی مجدد نیست.');
    if (input.status === 'rejected') {
      const rejected = await orders.updateOne({ _id: order._id, status: { $in: ['pending_review', 'approved'] } }, { $set: { status: 'rejected', reviewedAt: new Date(), updatedAt: new Date() }, $unset: { matchedCarrierIds: '', specialCarrierIds: '' } });
      if (!rejected.matchedCount) throw new ConflictException('وضعیت سفارش هم‌زمان تغییر کرده است. دوباره بارگذاری کنید.');
      return { id, status: 'rejected' };
    }
    const zoneTariffs = await this.readZoneTariffs();
    const candidates = await findEligibleTransportCarriers(this.connection.db!, order.weightKg, order.volumeM3, order.stops, zoneTariffs.densityKgPerM3);
    if (!candidates.length) throw new BadRequestException('برای این سفارش همکار راننده واجد شرایط پیدا نشد.');
    const eligible = new Set(candidates.map(candidate => candidate.memberId));
    const special = (input.specialCarrierIds ?? []).map(value => value.toLowerCase());
    if (special.some(value => !eligible.has(value))) throw new BadRequestException('راننده ویژه باید از میان همکاران واجد شرایط انتخاب شود.');
    const matchedCarrierIds = candidates.map(candidate => new Types.ObjectId(candidate.memberId));
    const specialCarrierIds = special.map(value => new Types.ObjectId(value));
    const tariffs = await this.connection.db!.collection<TransportTariffRecord>('transport_tariffs').findOne({ _id: 'default' }) ?? defaultTransportTariffs;
    const quote = await quoteTransportOrder(order.stops, order.weightKg, order.volumeM3, order.urgency, zoneTariffs);
    if (quote.routingPending) throw new BadRequestException('مسافت جاده‌ای در دسترس نیست؛ تا اتصال سرویس مسیریابی، تأیید و انتشار سفارش ممکن نیست.');
    const approved = await orders.updateOne({ _id: order._id, status: { $in: ['pending_review', 'approved'] } }, { $set: { status: 'approved', matchedCarrierIds, specialCarrierIds, quote, reviewedAt: new Date(), updatedAt: new Date() } });
    if (!approved.matchedCount) throw new ConflictException('وضعیت سفارش هم‌زمان تغییر کرده است. دوباره بارگذاری کنید.');
    return { id, status: 'approved', matchedCount: matchedCarrierIds.length, specialCount: specialCarrierIds.length };
  }

  private async readZoneTariffs(): Promise<TransportZoneTariffRecord> {
    const collection = this.connection.db!.collection<TransportZoneTariffRecord>('transport_zone_tariffs');
    await collection.updateOne({ _id: 'default' }, { $setOnInsert: defaultTransportZoneTariffs }, { upsert: true });
    return (await collection.findOne({ _id: 'default' })) ?? defaultTransportZoneTariffs;
  }

  @Get('transport-zone-tariffs')
  @UseGuards(AdminGuard)
  @Header('Cache-Control', 'private, no-store')
  async getTransportZoneTariffs() {
    const stored = await this.readZoneTariffs();
    return { ...stored, zones: zoneDefinitions, speeds: speedDefinitions };
  }

  @Patch('transport-zone-tariffs')
  @UseGuards(AdminGuard)
  async saveTransportZoneTariffs(@Body() input: TransportZoneTariffsDto) {
    const keys = input.rates.map(rate => rate.zoneId + ':' + rate.speed);
    const expected = zoneDefinitions.length * speedDefinitions.length;
    if (keys.length !== expected || new Set(keys).size !== expected ||
        zoneDefinitions.some(zone => speedDefinitions.some(speed => !keys.includes(zone.id + ':' + speed.id)))) {
      throw new BadRequestException('برای هر زون و سرعت باید دقیقاً یک تعرفه مستقل ثبت شود.');
    }
    const now = new Date();
    const record: TransportZoneTariffRecord = {
      _id: 'default', rates: input.rates, densityKgPerM3: input.densityKgPerM3,
      minimumKar: input.minimumKar, updatedAt: now,
    };
    await this.connection.db!.collection<TransportZoneTariffRecord>('transport_zone_tariffs')
      .updateOne({ _id: 'default' }, { $set: record, $setOnInsert: { createdAt: now } }, { upsert: true });
    return this.getTransportZoneTariffs();
  }

  @Get('transport-vehicles')
  @UseGuards(AdminGuard)
  @Header('Cache-Control', 'private, no-store')
  async listTransportVehicles(@Query() { page, limit, search }: CatalogQueryDto) {
    const escaped = [...(search ?? '').trim()].map(char => '.^$*+?()[]{}|\\'.includes(char) ? '\\' + char : char).join('');
    const pipeline: Record<string, unknown>[] = [
      { $lookup: { from: 'members', localField: 'memberId', foreignField: '_id', as: 'member' } },
      { $unwind: { path: '$member', preserveNullAndEmptyArrays: true } },
    ];
    if (escaped) {
      const pattern = new RegExp(escaped, 'i');
      pipeline.push({ $match: { $or: [
        { model: pattern }, { plate: pattern }, { license: pattern },
        { 'member.fullName': pattern }, { 'member.phone': pattern }, { 'member.organization': pattern },
      ] } });
    }
    pipeline.push({ $facet: {
      items: [
        { $sort: { updatedAt: -1, _id: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: {
          type: 1, className: 1, model: 1, year: 1, capacityKg: 1, plate: 1,
          license: 1, licenseClass: 1, bodyType: 1, insuranceExpiry: 1,
          technicalInspectionExpiry: 1, description: 1, createdAt: 1, updatedAt: 1, memberId: 1,
          member: { _id: '$member._id', fullName: '$member.fullName', phone: '$member.phone',
            organization: '$member.organization', city: '$member.city', serviceTypes: '$member.serviceTypes',
            isActive: '$member.isActive' },
        } },
      ],
      total: [{ $count: 'value' }],
    } });
    const [result] = await this.connection.db!.collection('member_vehicles').aggregate(pipeline).toArray();
    return { items: result?.items ?? [], total: result?.total?.[0]?.value ?? 0, page, limit };
  }
  @Get('orders')
  @AllowClient()
  @Header('Cache-Control', 'private, no-store')
  async listOrders(@Req() { access }: AccessRequest, @Query() { page, limit }: CatalogQueryDto) {
    if (access.role !== 'management' && !access.branchId) return { items: [], total: 0, page, limit };
    const filter = access.role === 'management' ? {} : { branchId: access.branchId };
    const [items, total] = await Promise.all([
      this.orders.find(filter).select('number status branchId createdAt').populate('branchId', 'name')
        .sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.orders.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  @Get(':list')
  @Header('Cache-Control', 'private, no-store')
  async list(@Param('list', new ParseEnumPipe(SettingsList)) list: SettingsList, @Req() { access }: AccessRequest) {
    if (list === SettingsList.Profiles) return this.profiles.find().sort({ name: 1 }).lean();
    return this.branches.find(access.role === 'management' ? {} : { _id: access.branchId ?? null }).sort({ name: 1 }).lean();
  }

  @Post(':list')
  @UseGuards(AdminGuard)
  create(@Param('list', new ParseEnumPipe(SettingsList)) list: SettingsList, @Body() input: SettingsInput) {
    return this.save(list, input);
  }

  @Patch(':list/:id')
  @UseGuards(AdminGuard)
  update(@Param('list', new ParseEnumPipe(SettingsList)) list: SettingsList, @Param('id') id: string, @Body() input: SettingsInput) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه معتبر نیست.');
    return this.save(list, input, id);
  }

  private async save(list: SettingsList, input: SettingsInput, id?: string) {
    const model = (list === SettingsList.Branches ? this.branches : this.profiles) as Model<Branch | Profile>;
    if ((!id && (!input.name?.trim() || !input.code)) || input.name?.trim() === '' ||
        Object.values(input).some(value => value === null) || (list === SettingsList.Profiles && input.city !== undefined)) {
      throw new BadRequestException('نام، کد یا فیلدهای رکورد معتبر نیستند.');
    }
    try {
      await model.init();
      const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const result = id ? await model.findByIdAndUpdate(id, { $set: fields }, { returnDocument: 'after', runValidators: true })
        : await model.create(fields);
      if (!result) throw new NotFoundException('رکورد پیدا نشد.');
      return result;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException('این کد قبلاً ثبت شده است.');
      }
      throw error;
    }
  }
}
