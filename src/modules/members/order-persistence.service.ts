import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

export interface OrderItemInput {
  productId: string;
  quantity: number;
  baseQuantity: number;
  name: string;
  unitId: string;
  unitName: string;
  unitsPerPack: number;
  price: { min: number; max: number };
  offerId: string;
  sellerName?: string;
}
export interface OrderCreateInput {
  id: string;
  memberId: Types.ObjectId;
  signature: string;
  items: OrderItemInput[];
  subtotal: { min: number; max: number };
  price: { min: number; max: number };
  total: number;
  currency: 'KAR';
  delivery?: Record<string, unknown>;
  source: { channel: 'web'; cartRevision?: number; requestId: string };
}
const moneyToMinor = (value: number) => {
  const minor = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new ConflictException('مبلغ سفارش معتبر نیست.');
  return minor;
};

@Injectable()
export class OrderPersistenceService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get db() { return this.connection.db!; }

  private async ensureIndexes() {
    await Promise.all([
      this.db.collection('orders').createIndex({ orderNumber: 1 }, { unique: true, name: 'uq_orders_order_number' }),
      this.db.collection('orders').createIndex({ memberId: 1, createdAt: -1, _id: -1 }, { name: 'ix_orders_member_created' }),
      this.db.collection('orders').createIndex({ status: 1, createdAt: -1 }, { name: 'ix_orders_status_created' }),
      this.db.collection('orders').createIndex({ 'source.requestId': 1, memberId: 1 }, { unique: true, name: 'uq_orders_request_member' }),
      this.db.collection('orderItems').createIndex({ orderId: 1, lineNumber: 1 }, { unique: true, name: 'uq_order_items_line' }),
      this.db.collection('orderItems').createIndex({ productId: 1, createdAt: -1 }, { name: 'ix_order_items_product_created' }),
      this.db.collection('orderItems').createIndex({ sellerId: 1, createdAt: -1 }, { name: 'ix_order_items_seller_created', sparse: true }),
      this.db.collection('orderMeta').createIndex({ updatedAt: -1 }, { name: 'ix_order_meta_updated' }),
      this.db.collection('orderEvents').createIndex({ orderId: 1, occurredAt: 1 }, { name: 'ix_order_events_timeline' }),
    ]);
  }

  async create(input: OrderCreateInput) {
    await this.ensureIndexes();
    const orders = this.db.collection('orders');
    const existing = await orders.findOne({ _id: input.id });
    if (existing) {
      if (existing.signature !== input.signature || String(existing.memberId) !== String(input.memberId)) {
        throw new ConflictException('این شناسه درخواست قبلاً برای سفارش دیگری استفاده شده است.');
      }
      if (existing.status === 'pending' || existing.status !== 'creating') return this.summary(existing);
    }

    let orderNumber = existing?.orderNumber as string | undefined;
    if (!orderNumber) {
      const year = new Date().getUTCFullYear();
      const counterResult = await this.db.collection('order_sequences').findOneAndUpdate(
        { _id: 'orders:' + year }, { $inc: { value: 1 }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, returnDocument: 'after' },
      ) as any;
      const counter = counterResult?.value ?? counterResult;
      orderNumber = 'SC-' + year + '-' + String(counter.value).padStart(8, '0');
    }

    const now = new Date();
    const order = {
      _id: input.id, orderNumber, memberId: input.memberId, createdBy: input.memberId,
      status: 'creating', currency: input.currency, subtotal: {
        min: moneyToMinor(input.subtotal.min), max: moneyToMinor(input.subtotal.max),
      }, total: moneyToMinor(input.total), price: {
        min: moneyToMinor(input.price.min), max: moneyToMinor(input.price.max),
      }, itemCount: input.items.length, source: input.source, signature: input.signature,
      schemaVersion: 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    await orders.updateOne({ _id: input.id }, { $setOnInsert: order }, { upsert: true });
    const current = await orders.findOne({ _id: input.id });
    if (!current || current.signature !== input.signature) throw new ConflictException('ثبت سفارش هم‌زمان با درخواست دیگری تداخل پیدا کرد.');
    if (current.status !== 'pending') {
      const itemCollection = this.db.collection('orderItems');
      for (let index = 0; index < input.items.length; index++) {
        const item = input.items[index];
        const unitPriceMin = moneyToMinor(item.price.min);
        const unitPriceMax = moneyToMinor(item.price.max);
        await itemCollection.replaceOne({ _id: input.id + ':' + (index + 1) }, { 
          _id: input.id + ':' + (index + 1), orderId: input.id, lineNumber: index + 1,
          productId: item.productId, offerId: item.offerId, name: item.name,
          quantity: item.quantity, baseQuantity: item.baseQuantity, unitId: item.unitId,
          unitName: item.unitName, unitsPerPack: item.unitsPerPack,
          unitPrice: { min: unitPriceMin, max: unitPriceMax },
          lineSubtotal: { min: unitPriceMin * item.baseQuantity, max: unitPriceMax * item.baseQuantity },
          currency: input.currency, sellerName: item.sellerName,
          createdBy: input.memberId, createdAt: now, updatedAt: now, schemaVersion: 1,
        }, { upsert: true });
      }
      await this.db.collection('orderMeta').updateOne({ _id: input.id }, {
        $setOnInsert: { orderId: input.id, createdAt: now },
        $set: {
          shipping: input.delivery ? { method: input.delivery, status: 'pending' } : { status: 'not_requested' },
          payment: { method: 'unselected', status: 'pending', currency: input.currency },
          discounts: { total: 0, currency: input.currency, allocations: [] },
          accounting: { provider: null, externalDocumentId: null, syncStatus: 'not_synced' },
          extensions: {}, updatedAt: now, schemaVersion: 1,
        },
      }, { upsert: true });
      await this.db.collection('orderEvents').updateOne(
        { _id: input.id + ':created' },
        { $setOnInsert: { orderId: input.id, type: 'order.created', fromStatus: null, toStatus: 'pending', actorId: input.memberId, occurredAt: now, payload: { source: input.source }, schemaVersion: 1 } },
        { upsert: true },
      );
      await orders.updateOne({ _id: input.id, status: 'creating' }, { $set: { status: 'pending', updatedAt: new Date() } });
    }
    return this.summary(await orders.findOne({ _id: input.id }));
  }

  async list(memberId: Types.ObjectId, page: number, limit: number) {
    await this.ensureIndexes();
    const orders = this.db.collection('orders');
    const filter = { memberId, status: { $nin: ['completed', 'cancelled', 'creating'] } };
    const [items, total] = await Promise.all([
      orders.find(filter, { projection: { signature: 0, memberId: 0 } })
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      orders.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  private summary(order: any) {
    if (!order) throw new ConflictException('سفارش ذخیره نشد؛ دوباره تلاش کنید.');
    const asMoney = (range: any) => range ? { min: range.min / 1_000_000, max: range.max / 1_000_000 } : undefined;
    return { id: order._id, orderNumber: order.orderNumber, total: order.total / 1_000_000,
      currency: order.currency, price: asMoney(order.price), subtotal: asMoney(order.subtotal), status: order.status };
  }
}
