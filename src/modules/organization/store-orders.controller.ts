import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Connection, Types } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AccessRequest } from '../auth/access';

const STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'completed', 'cancelled', 'returned'] as const;
class StoreOrderUpdateDto {
  @IsOptional() @IsIn(STATUSES) status?: typeof STATUSES[number];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100000000) total?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100000000) shippingFee?: number;
  @IsOptional() @IsString() @MaxLength(80) trackingCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) adminNote?: string;
}
const fromMinor = (value: any) => typeof value === 'number' ? value / 1_000_000 : 0;
const toMinor = (value: number) => {
  const result = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(result)) throw new BadRequestException('مبلغ سفارش معتبر نیست.');
  return result;
};

@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, AdminGuard)
@Controller('organization/store-orders')
export class StoreOrdersController {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Req() _request: AccessRequest, @Query('page') pageRaw = '1', @Query('limit') limitRaw = '20',
    @Query('status') status = 'all', @Query('search') search = '') {
    const page = Math.max(1, Math.min(10000, Number(pageRaw) || 1));
    const limit = Math.max(1, Math.min(100, Number(limitRaw) || 20));
    const validStatus = ['all', 'current', ...STATUSES] as string[];
    if (!validStatus.includes(status)) throw new BadRequestException('فیلتر وضعیت معتبر نیست.');
    const escaped = [...search.trim()].map(char => '.^$*+?()[]{}|\\'.includes(char) ? '\\' + char : char).join('');
    const regex = escaped ? new RegExp(escaped, 'i') : undefined;
    const filter: Record<string, any> = { status: { $ne: 'creating' } };
    if (status === 'current') filter.status = { $in: ['pending', 'confirmed', 'processing', 'shipped'] };
    else if (status !== 'all') filter.status = status;
    if (regex) filter.$or = [{ orderNumber: regex }, { 'customer.fullName': regex }, { 'customer.phone': regex }];
    const orders = this.db.collection<any>('orders');
    const allFilter = { status: { $ne: 'creating' } };
    const [items, total, grouped] = await Promise.all([
      orders.find(filter, { projection: { signature: 0 } }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      orders.countDocuments(filter),
      orders.aggregate([{ $match: allFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
    ]);
    const counts = grouped.reduce((out, row) => { out[row._id] = row.count; return out; }, {} as Record<string, number>);
    const ids = items.map(order => String(order._id));
    const [lines, members] = await Promise.all([
      ids.length ? this.db.collection<any>('orderItems').find({ orderId: { $in: ids } }).sort({ orderId: 1, lineNumber: 1 }).toArray() : [],
      items.length ? this.db.collection<any>('members').find({ _id: { $in: items.map(order => order.memberId).filter(Boolean) } }, { projection: { fullName: 1, phone: 1, organization: 1 } }).toArray() : [],
    ]);
    const productIds = [...new Set(lines.map(line => String(line.productId)).filter(id => Types.ObjectId.isValid(id)))];
    const products = productIds.length ? await this.db.collection<any>('products').find(
      { _id: { $in: productIds.map(id => new Types.ObjectId(id)) } },
      { projection: { imageUrl: 1, thumbnailUrl: 1, gallery: 1, sku: 1 } },
    ).toArray() : [];
    const productMap = new Map(products.map(product => [String(product._id), product]));
    const memberMap = new Map(members.map(member => [String(member._id), member]));
    const linesByOrder = new Map<string, any[]>();
    for (const line of lines) {
      const list = linesByOrder.get(String(line.orderId)) ?? [];
      const product = productMap.get(String(line.productId));
      list.push({ ...line, image: product?.thumbnailUrl || product?.imageUrl || product?.gallery?.[0] || null, sku: product?.sku || null, unitPrice: { min: fromMinor(line.unitPrice?.min), max: fromMinor(line.unitPrice?.max) },
        lineSubtotal: { min: fromMinor(line.lineSubtotal?.min), max: fromMinor(line.lineSubtotal?.max) } });
      linesByOrder.set(String(line.orderId), list);
    }
    return {
      items: items.map(order => ({ ...order, customer: memberMap.get(String(order.memberId)) ?? order.customer ?? null,
        total: fromMinor(order.total), subtotal: { min: fromMinor(order.subtotal?.min), max: fromMinor(order.subtotal?.max) },
        price: { min: fromMinor(order.price?.min), max: fromMinor(order.price?.max) },
        items: linesByOrder.get(String(order._id)) ?? [] })),
      counts: { current: ['pending','confirmed','processing','shipped'].reduce((sum, key) => sum + (counts[key] || 0), 0),
        completed: counts.completed || 0, returned: counts.returned || 0, cancelled: counts.cancelled || counts.canceled || 0, total: Object.values(counts).reduce((a: number,b: any) => a + b, 0) },
      total, page, limit,
    };
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async detail(@Param('id') id: string) {
    const order = await this.db.collection<any>('orders').findOne({ _id: id, status: { $ne: 'creating' } }, { projection: { signature: 0 } });
    if (!order) throw new NotFoundException('سفارش پیدا نشد.');
    const [items, meta, events, member] = await Promise.all([
      this.db.collection<any>('orderItems').find({ orderId: id }).sort({ lineNumber: 1 }).toArray(),
      this.db.collection<any>('orderMeta').findOne({ _id: id }),
      this.db.collection<any>('orderEvents').find({ orderId: id }).sort({ occurredAt: 1 }).toArray(),
      order.memberId ? this.db.collection<any>('members').findOne({ _id: order.memberId }, { projection: { fullName: 1, phone: 1, organization: 1, deliveryAddresses: 1 } }) : null,
    ]);
    const productIds = [...new Set(items.map(item => String(item.productId)).filter(id => Types.ObjectId.isValid(id)))];
    const products = productIds.length ? await this.db.collection<any>('products').find(
      { _id: { $in: productIds.map(id => new Types.ObjectId(id)) } },
      { projection: { imageUrl: 1, thumbnailUrl: 1, gallery: 1, sku: 1 } },
    ).toArray() : [];
    const productMap = new Map(products.map(product => [String(product._id), product]));
    return { ...order, customer: member ?? order.customer ?? null, total: fromMinor(order.total),
      meta: meta ? { ...meta, shipping: meta.shipping ? { ...meta.shipping, fee: fromMinor(meta.shipping.fee) } : meta.shipping } : meta,
      subtotal: { min: fromMinor(order.subtotal?.min), max: fromMinor(order.subtotal?.max) },
      price: { min: fromMinor(order.price?.min), max: fromMinor(order.price?.max) },
      items: items.map(item => { const product = productMap.get(String(item.productId)); return { ...item, image: product?.thumbnailUrl || product?.imageUrl || product?.gallery?.[0] || null, sku: product?.sku || null, unitPrice: { min: fromMinor(item.unitPrice?.min), max: fromMinor(item.unitPrice?.max) },
        lineSubtotal: { min: fromMinor(item.lineSubtotal?.min), max: fromMinor(item.lineSubtotal?.max) } }; }),
      meta, events };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() input: StoreOrderUpdateDto, @Req() request: AccessRequest) {
    const orders = this.db.collection<any>('orders');
    const order = await orders.findOne({ _id: id, status: { $ne: 'creating' } });
    if (!order) throw new NotFoundException('سفارش پیدا نشد.');
    const now = new Date();
    const set: Record<string, any> = { updatedAt: now };
    if (input.status !== undefined) set.status = input.status;
    if (input.total !== undefined) set.total = toMinor(input.total);
    if (input.trackingCode !== undefined) set['delivery.trackingCode'] = input.trackingCode.trim();
    if (input.adminNote !== undefined) set.adminNote = input.adminNote.trim();
    if (input.shippingFee !== undefined) {
      const fee = toMinor(input.shippingFee);
      const subtotal = Math.max(0, Number(order.subtotal?.max ?? 0));
      if (input.total === undefined) set.total = toMinor(subtotal / 1_000_000 + input.shippingFee);
      await this.db.collection<any>('orderMeta').updateOne({ _id: id }, {
        $set: { 'shipping.fee': fee, updatedAt: now }, $setOnInsert: { orderId: id, createdAt: now },
      }, { upsert: true });
    }
    await orders.updateOne({ _id: id }, { $set: set });
    if (input.status !== undefined && input.status !== order.status) {
      await this.db.collection<any>('orderEvents').insertOne({ orderId: id, type: 'order.status_changed',
        fromStatus: order.status, toStatus: input.status, actorId: request.userId, actorType: 'management',
        occurredAt: now, payload: { source: 'admin-panel' }, schemaVersion: 1 });
    }
    return this.detail(id);
  }
}
