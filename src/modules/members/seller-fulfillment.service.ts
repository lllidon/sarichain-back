import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

const SELLER_STATES = ['pending', 'accepted', 'preparing', 'ready', 'handed_over'] as const;
type SellerState = typeof SELLER_STATES[number];
const NEXT: Record<SellerState, SellerState | null> = {
  pending: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'handed_over', handed_over: null,
};
const LABELS: Record<SellerState, string> = {
  pending: 'در انتظار بررسی', accepted: 'پذیرفته‌شده', preparing: 'در حال آماده‌سازی',
  ready: 'آماده تحویل به حمل', handed_over: 'تحویل به حمل‌کننده',
};

@Injectable()
export class SellerFulfillmentService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { if (!this.connection.db) throw new Error('MongoDB is not connected.'); return this.connection.db; }

  async list(memberId: Types.ObjectId, page = 1, limit = 20, filter = 'active') {
    const sellerId = String(memberId);
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const orderItems = this.db.collection<any>('orderItems');
    await orderItems.createIndex({ sellerId: 1, createdAt: -1, orderId: 1 }, { name: 'ix_seller_order_items_dashboard' });
    const lines = await orderItems.find({ sellerId }).sort({ createdAt: -1, orderId: 1, lineNumber: 1 }).toArray();
    const orderIds = [...new Set(lines.map(line => String(line.orderId)))];
    if (!orderIds.length) return { items: [], total: 0, page: safePage, limit: safeLimit, counts: { active: 0, pending: 0, accepted: 0, preparing: 0, ready: 0, handed_over: 0 } };
    const [orders, fulfillments] = await Promise.all([
      this.db.collection<any>('orders').find({ _id: { $in: orderIds }, status: { $nin: ['creating', 'completed', 'cancelled', 'canceled', 'returned', 'refunded'] } },
        { projection: { signature: 0 } }).sort({ createdAt: -1, _id: -1 }).toArray(),
      this.db.collection<any>('sellerOrderFulfillments').find({ sellerId, orderId: { $in: orderIds } }).toArray(),
    ]);
    const visibleIds = new Set(orders.map(order => String(order._id)));
    const meta = await this.db.collection<any>('orderMeta').find({ _id: { $in: [...visibleIds] } }).toArray();
    const memberIds = [...new Set(orders.map(order => order.memberId).filter(Boolean).map(String))]
      .filter((id: string) => Types.ObjectId.isValid(id))
      .map((id: string) => new Types.ObjectId(id));
    const buyers = memberIds.length ? await this.db.collection<any>('members').find({ _id: { $in: memberIds } },
      { projection: { fullName: 1, organization: 1, city: 1, province: 1 } }).toArray() : [];
    const fulfillmentByOrder = new Map(fulfillments.map(row => [String(row.orderId), row]));
    const metaByOrder = new Map(meta.map(row => [String(row._id), row]));
    const buyerById = new Map(buyers.map(row => [String(row._id), row]));
    const linesByOrder = new Map<string, any[]>();
    for (const line of lines) {
      const id = String(line.orderId);
      if (!visibleIds.has(id)) continue;
      const bucket = linesByOrder.get(id) ?? [];
      bucket.push({
        id: String(line._id), name: line.name, sku: line.sku, quantity: line.quantity,
        baseQuantity: line.baseQuantity, unitName: line.unitName, unit: line.unit,
        sellerName: line.sellerName, price: line.unitPrice?.max ?? line.unitPrice?.min,
        subtotal: line.lineSubtotal?.max ?? line.lineSubtotal?.min,
      });
      linesByOrder.set(id, bucket);
    }
    const rows = orders.map(order => {
      const id = String(order._id);
      const fulfillment = fulfillmentByOrder.get(id);
      const state: SellerState = SELLER_STATES.includes(fulfillment?.status) ? fulfillment.status : 'pending';
      const buyer = buyerById.get(String(order.memberId));
      const shipping = metaByOrder.get(id)?.shipping ?? {};
      const delivery = order.delivery ?? {};
      const address = delivery.addressSnapshot ?? {};
      return {
        id, orderNumber: order.orderNumber, orderStatus: order.status, createdAt: order.createdAt,
        updatedAt: fulfillment?.updatedAt ?? order.updatedAt, status: state, statusLabel: LABELS[state],
        nextStatus: NEXT[state], buyer: { name: buyer?.organization || buyer?.fullName || 'مشتری ساری‌چین', city: buyer?.city || address.city || '', province: buyer?.province || address.province || '' },
        items: linesByOrder.get(id) ?? [], itemCount: (linesByOrder.get(id) ?? []).length,
        total: Number(order.total || 0) / 1_000_000,
        delivery: { method: delivery.method, dispatchDate: delivery.dispatchDate, slot: delivery.slot,
          addressTitle: address.title, city: address.city, province: address.province, shippingStatus: shipping.status },
        allowedToPrepare: order.status === 'confirmed' || ['paid', 'confirmed'].includes(metaByOrder.get(id)?.payment?.status),
      };
    });
    const filtered = filter === 'all' ? rows : filter === 'completed' ? rows.filter(row => row.status === 'handed_over')
      : rows.filter(row => row.status !== 'handed_over');
    const counts = { active: rows.filter(row => row.status !== 'handed_over').length,
      ...Object.fromEntries(SELLER_STATES.map(state => [state, rows.filter(row => row.status === state).length])) };
    return { items: filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit), total: filtered.length,
      page: safePage, limit: safeLimit, counts };
  }

  async update(memberId: Types.ObjectId, orderId: string, target: string) {
    if (!/^[a-f0-9]{64}$/i.test(orderId) || !SELLER_STATES.includes(target as SellerState)) {
      throw new BadRequestException('شناسه سفارش یا وضعیت انتخاب‌شده معتبر نیست.');
    }
    const sellerId = String(memberId);
    const collection = this.db.collection<any>('sellerOrderFulfillments');
    await collection.createIndex({ orderId: 1, sellerId: 1 }, { unique: true, name: 'uq_seller_fulfillment_order_seller' });
    const session = await this.connection.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const ownedLines = await this.db.collection<any>('orderItems').countDocuments({ orderId, sellerId }, { session });
        if (!ownedLines) throw new NotFoundException('این سفارش برای حساب شما ثبت نشده است.');
        const order = await this.db.collection<any>('orders').findOne({ _id: orderId }, { session });
        if (!order || ['cancelled', 'canceled', 'returned', 'refunded', 'completed'].includes(order.status)) {
          throw new ConflictException('این سفارش دیگر قابل پردازش نیست.');
        }
        const meta = await this.db.collection<any>('orderMeta').findOne({ _id: orderId }, { session });
        if (target === 'preparing' && !(order.status === 'confirmed' || ['paid', 'confirmed'].includes(meta?.payment?.status))) {
          throw new ConflictException('شروع آماده‌سازی پس از تأیید سفارش یا پرداخت امکان‌پذیر است.');
        }
        const id = orderId + ':' + sellerId;
        const current = await collection.findOne({ _id: id }, { session });
        const previous: SellerState = SELLER_STATES.includes(current?.status) ? current.status : 'pending';
        if (previous === target) {
          response = { orderId, status: previous, statusLabel: LABELS[previous], idempotent: true };
          return;
        }
        if (NEXT[previous] !== target) throw new ConflictException('ترتیب مراحل پردازش رعایت نشده است؛ ابتدا مرحله قبلی را تکمیل کنید.');
        const now = new Date();
        const updated = await collection.updateOne(
          { _id: id, ...(current ? { status: previous, updatedAt: current.updatedAt } : { status: { $exists: false } }) },
          { $set: { status: target, updatedAt: now, updatedBy: memberId },
            $setOnInsert: { orderId, sellerId, createdAt: now } }, { upsert: !current, session },
        );
        if (!updated.modifiedCount && !updated.upsertedCount) throw new ConflictException('وضعیت سفارش هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.');
        await this.db.collection<any>('sellerOrderFulfillmentEvents').insertOne({
          orderId, sellerId, fromStatus: previous, toStatus: target, actorId: memberId,
          occurredAt: now, schemaVersion: 1,
        }, { session });
        response = { orderId, status: target, statusLabel: LABELS[target as SellerState], updatedAt: now };
      });
      return response;
    } finally {
      await session.endSession();
    }
  }
}
