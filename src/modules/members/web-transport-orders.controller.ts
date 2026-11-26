import { BadRequestException, ConflictException, Controller, Get, Headers, NotFoundException, Param, Patch, Post, Body, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Connection, Types, isObjectIdOrHexString } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { MarketplaceAccounts } from './marketplace-account.service';
import { TransportOrderDto, TransportZoneTariffRecord, defaultTransportZoneTariffs, findEligibleTransportCarriers, quoteTransportOrder } from './transport-orders';

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/transport-orders')
export class WebTransportOrdersController {
  constructor(private readonly accounts: MarketplaceAccounts, @InjectConnection() private readonly connection: Connection) {}

  private get orders() {
    return this.connection.db!.collection('transport_orders');
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Headers('authorization') authorization: string | undefined) {
    const member = await this.accounts.requireMember(authorization);
    const own = await this.orders.find({ memberId: member._id }, { projection: { memberId: 0, matchedCarrierIds: 0, specialCarrierIds: 0, assignedCarrierId: 0 } })
      .sort({ createdAt: -1, _id: -1 }).limit(30).toArray();
    const jobs = member.serviceTypes?.includes('driver') && member.driverReview?.status === 'approved'
      ? await this.orders.find({ $or: [
          { status: 'approved', matchedCarrierIds: member._id, assignedCarrierId: { $exists: false } },
          { status: { $in: ['assigned', 'in_transit', 'delivered'] }, assignedCarrierId: member._id },
        ] },
        { projection: { memberId: 0, customer: 0, matchedCarrierIds: 0, assignedCarrierId: 0 } }).sort({ createdAt: -1 }).limit(30).toArray()
      : [];
    return {
      items: [
        ...own.map(order => ({ ...order, kind: 'own' })),
        ...jobs.map(({ specialCarrierIds, ...order }) => ({ ...order, kind: 'job', special: (specialCarrierIds ?? []).some((id: Types.ObjectId) => id.equals(member._id)) })),
      ],
      total: own.length + jobs.length, page: 1, limit: Math.max(1, own.length + jobs.length),
    };
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  async create(@Headers('authorization') authorization: string | undefined, @Body() input: TransportOrderDto) {
    const member = await this.accounts.requireMember(authorization);
    const pickups = input.stops.filter(stop => stop.kind === 'pickup');
    const dropoffs = input.stops.filter(stop => stop.kind === 'dropoff');
    if (!pickups.length || !dropoffs.length) throw new BadRequestException('حداقل یک مبدأ و یک مقصد لازم است.');
    const deadlineMs = new Date(input.deadline).getTime() - Date.now();
    if (deadlineMs <= 0) throw new BadRequestException('مهلت تحویل باید در آینده باشد.');
    const speedLimitMs: Record<string, number> = { normal: 5 * 86400000, special: 2 * 86400000, express: 86400000, urgent: 3 * 3600000 };
    if (deadlineMs > speedLimitMs[input.urgency]) throw new BadRequestException('مهلت تحویل با سرعت انتخاب‌شده هم‌خوانی ندارد.');
    const tariffs = await this.connection.db!.collection<TransportZoneTariffRecord>('transport_zone_tariffs').findOne({ _id: 'default' }) ?? defaultTransportZoneTariffs;
    const quote = await quoteTransportOrder(input.stops, input.weightKg, input.volumeM3, input.urgency, tariffs);
    const now = new Date();
    await this.orders.createIndex({ memberId: 1, createdAt: -1 }, { name: 'transport_customer_orders' });
    await this.orders.createIndex({ status: 1, matchedCarrierIds: 1, assignedCarrierId: 1 }, { name: 'transport_carrier_feed' });
    const { insertedId } = await this.orders.insertOne({
      memberId: member._id,
      customer: { fullName: member.fullName, phone: member.phone, organization: member.organization },
      stops: input.stops,
      goodsType: input.goodsType.trim(),
      weightKg: input.weightKg,
      volumeM3: input.volumeM3,
      urgency: input.urgency,
      deadline: new Date(input.deadline),
      description: input.description?.trim() ?? '',
      quote,
      status: 'pending_review',
      matchedCarrierIds: [],
      specialCarrierIds: [],
      createdAt: now,
      updatedAt: now,
    });
    return { id: insertedId, status: 'pending_review', quote };
  }

  @Patch(':id/accept')
  @Header('Cache-Control', 'private, no-store')
  async accept(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    const member = await this.accounts.requireMember(authorization);
    if (!isObjectIdOrHexString(id)) throw new NotFoundException();
    if (!member.serviceTypes?.includes('driver') || member.driverReview?.status !== 'approved') {
      throw new BadRequestException('حساب راننده شما هنوز تأیید نشده است.');
    }
    const order = await this.orders.findOne({ _id: new Types.ObjectId(id), status: 'approved', matchedCarrierIds: member._id, assignedCarrierId: { $exists: false } });
    if (!order) throw new ConflictException('این سفارش دیگر در دسترس نیست یا به همکار دیگری واگذار شده است.');
    const tariff = await this.connection.db!.collection<TransportZoneTariffRecord>('transport_zone_tariffs').findOne({ _id: 'default' }) ?? defaultTransportZoneTariffs;
    const stillEligible = await findEligibleTransportCarriers(this.connection.db!, order.weightKg, order.volumeM3, order.stops, tariff.densityKgPerM3);
    if (!stillEligible.some(candidate => candidate.memberId === String(member._id))) {
      throw new ConflictException('ظرفیت یا محدوده خدمت وسیله نقلیه شما دیگر با این سفارش مطابقت ندارد.');
    }
    const special = (order.specialCarrierIds ?? []).some((carrierId: Types.ObjectId) => carrierId.equals(member._id));
    const acceptedRateKar = special ? order.quote.specialKar : order.quote.standardKar;
    const result = await this.orders.findOneAndUpdate(
      { _id: order._id, status: 'approved', assignedCarrierId: { $exists: false }, matchedCarrierIds: member._id },
      { $set: { status: 'assigned', assignedCarrierId: member._id, acceptedRateKar, acceptedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!result) throw new ConflictException('این سفارش هم‌زمان به همکار دیگری واگذار شد.');
    return { id: result._id, status: result.status, acceptedRateKar };
  }
}
