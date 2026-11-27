import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { normalizePhone } from '../auth/phone';

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
  sellerId?: string;
  sellerName?: string;
}
export interface OrderCreateInput {
  id: string;
  memberId: Types.ObjectId;
  customerPhone?: string;
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
      this.db.collection<any>('orders').createIndex({ orderNumber: 1 }, { unique: true, name: 'uq_orders_order_number' }),
      this.db.collection<any>('orders').createIndex({ memberId: 1, createdAt: -1, _id: -1 }, { name: 'ix_orders_member_created' }),
      this.db.collection<any>('orders').createIndex({ status: 1, createdAt: -1 }, { name: 'ix_orders_status_created' }),
      this.db.collection<any>('orders').createIndex({ 'source.requestId': 1, memberId: 1 }, { unique: true, name: 'uq_orders_request_member', partialFilterExpression: { 'source.requestId': { $type: 'string' } } }),
      this.db.collection<any>('orderItems').createIndex({ orderId: 1, lineNumber: 1 }, { unique: true, name: 'uq_order_items_line' }),
      this.db.collection<any>('orderItems').createIndex({ productId: 1, createdAt: -1 }, { name: 'ix_order_items_product_created' }),
      this.db.collection<any>('orderItems').createIndex({ sellerId: 1, createdAt: -1 }, { name: 'ix_order_items_seller_created', sparse: true }),
      this.db.collection<any>('orderMeta').createIndex({ updatedAt: -1 }, { name: 'ix_order_meta_updated' }),
      this.db.collection<any>('orderEvents').createIndex({ orderId: 1, occurredAt: 1 }, { name: 'ix_order_events_timeline' }),
    ]);
  }

  async recordWorkflowLog(input: { orderId: string; stage: string; status: 'started' | 'succeeded' | 'failed'; actorId: Types.ObjectId | string; correlationId: string; details?: Record<string, unknown>; error?: string }) {
    await this.db.collection<any>('orderProcessingLogs').insertOne({
      orderId: input.orderId, stage: input.stage, status: input.status,
      actor: { id: input.actorId, type: 'member' }, correlationId: input.correlationId,
      details: input.details ?? {}, ...(input.error && { error: input.error }),
      occurredAt: new Date(), schemaVersion: 1,
    });
  }

  async findExisting(id: string, signature: string, memberId: Types.ObjectId) {
    const existing = await this.db.collection<any>('orders').findOne({ _id: id });
    if (!existing) return null;
    if (existing.signature !== signature || String(existing.memberId) !== String(memberId)) {
      throw new ConflictException('این شناسه درخواست قبلاً برای سفارش دیگری استفاده شده است.');
    }
    if (existing.status === 'creating') return null;
    return this.summary(existing);
  }

  async create(input: OrderCreateInput) {
    await this.ensureIndexes();
    await this.recordWorkflowLog({ orderId: input.id, stage: 'order.persistence.started', status: 'started', actorId: input.memberId, correlationId: input.source.requestId, details: { itemCount: input.items.length } });
    const orders = this.db.collection<any>('orders');
    const existing = await orders.findOne({ _id: input.id });
    if (existing) {
      if (existing.signature !== input.signature || String(existing.memberId) !== String(input.memberId)) {
        throw new ConflictException('این شناسه درخواست قبلاً برای سفارش دیگری استفاده شده است.');
      }
      if (existing.status === 'pending' || existing.status !== 'creating') return this.summary(existing);
    }

    let orderNumber = existing?.orderNumber as string | undefined;
    if (!orderNumber) {
      // Use the Iranian (Jalali) calendar and Tehran's local date for customer-facing order numbers.
      const dateParts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
        timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date()).reduce<Record<string, string>>((parts, part) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
        return parts;
      }, {});
      const year = dateParts.year?.slice(-2);
      const month = dateParts.month?.padStart(2, '0');
      const day = dateParts.day?.padStart(2, '0');
      if (!year || !month || !day) throw new ConflictException('تاریخ سفارش برای تولید شماره سفارش قابل محاسبه نیست.');

      const normalizedPhone = input.customerPhone ? normalizePhone(input.customerPhone) : '';
      const customerCode = normalizedPhone ? normalizedPhone.slice(-2) : '00';
      const dateCode = year + month + day;

      // MongoDB Node driver versions differ: v5 returns ModifyResult.value (document),
      // while newer versions return the updated document directly.
      const counterResult = await this.db.collection<any>('order_sequences').findOneAndUpdate(
        { _id: 'orders:' + dateCode + ':' + customerCode },
        { $inc: { value: 1 }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, returnDocument: 'after' },
      ) as any;
      const counterDocument = counterResult?.value && typeof counterResult.value === 'object'
        ? counterResult.value
        : counterResult;
      const sequence = Number(counterDocument?.value);
      if (!Number.isSafeInteger(sequence) || sequence < 1) {
        throw new ConflictException('شمارنده شماره سفارش به‌درستی تولید نشد.');
      }
      orderNumber = 'SC' + dateCode + customerCode + String(sequence).padStart(4, '0');
    }

    const now = new Date();
    const order = {
      _id: input.id, orderNumber, memberId: input.memberId, createdBy: input.memberId,
      status: 'creating', inventoryStatus: 'not_reserved', currency: input.currency, subtotal: {
        min: moneyToMinor(input.subtotal.min), max: moneyToMinor(input.subtotal.max),
      }, total: moneyToMinor(input.total), price: {
        min: moneyToMinor(input.price.min), max: moneyToMinor(input.price.max),
      }, itemCount: input.items.length, source: input.source, signature: input.signature, ...(input.delivery && { delivery: input.delivery }),
      schemaVersion: 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    await orders.updateOne({ _id: input.id }, { $setOnInsert: order }, { upsert: true });
    const current = await orders.findOne({ _id: input.id });
    if (!current || current.signature !== input.signature) throw new ConflictException('ثبت سفارش هم‌زمان با درخواست دیگری تداخل پیدا کرد.');
    if (current.status !== 'pending') {
      const itemCollection = this.db.collection<any>('orderItems');
      for (let index = 0; index < input.items.length; index++) {
        const item = input.items[index];
        const unitPriceMin = moneyToMinor(item.price.min);
        const unitPriceMax = moneyToMinor(item.price.max);
        await itemCollection.replaceOne({ _id: input.id + ':' + (index + 1) }, { 
          _id: input.id + ':' + (index + 1), orderId: input.id, lineNumber: index + 1,
          productId: item.productId, offerId: item.offerId, sellerId: item.sellerId, name: item.name,
          quantity: item.quantity, baseQuantity: item.baseQuantity, unitId: item.unitId,
          unitName: item.unitName, unitsPerPack: item.unitsPerPack,
          unitPrice: { min: unitPriceMin, max: unitPriceMax },
          lineSubtotal: { min: moneyToMinor(item.price.min * item.baseQuantity), max: moneyToMinor(item.price.max * item.baseQuantity) },
          currency: input.currency, sellerName: item.sellerName,
          createdBy: input.memberId, createdAt: now, updatedAt: now, schemaVersion: 1,
        }, { upsert: true });
      }
      await this.db.collection<any>('orderMeta').updateOne({ _id: input.id }, {
        $setOnInsert: { orderId: input.id, createdAt: now },
        $set: {
          shipping: input.delivery ? { method: input.delivery, status: 'pending' } : { status: 'not_requested' },
          payment: { method: 'unselected', status: 'pending', currency: input.currency },
          inventory: { status: 'not_reserved', source: 'seller_offers', stagingWarehouseId: null },
          discounts: { total: 0, currency: input.currency, allocations: [] },
          accounting: { provider: null, externalDocumentId: null, syncStatus: 'not_synced' },
          extensions: {}, updatedAt: now, schemaVersion: 1,
        },
      }, { upsert: true });
      await this.db.collection<any>('orderEvents').updateOne(
        { _id: input.id + ':created' },
        { $setOnInsert: { orderId: input.id, type: 'order.created', fromStatus: null, toStatus: 'pending', actorId: input.memberId, occurredAt: now, payload: { source: input.source }, schemaVersion: 1 } },
        { upsert: true },
      );
      await orders.updateOne({ _id: input.id, status: 'creating' }, { $set: { status: 'pending', updatedAt: new Date() } });
      await this.recordWorkflowLog({ orderId: input.id, stage: 'order.persistence.completed', status: 'succeeded', actorId: input.memberId, correlationId: input.source.requestId, details: { orderNumber, itemCount: input.items.length } });
    }
    return this.summary(await orders.findOne({ _id: input.id }));
  }

  async list(memberId: Types.ObjectId, page: number, limit: number, status?: string) {
    await this.ensureIndexes();
    const orders = this.db.collection<any>('orders');
    const allOrdersFilter = { memberId, status: { $ne: 'creating' } };
    const filter: Record<string, any> = { ...allOrdersFilter };
    if (status === 'current') filter.status = { $nin: ['creating', 'completed', 'returned', 'refunded', 'cancelled', 'canceled'] };
    else if (status === 'completed') filter.status = 'completed';
    else if (status === 'returned') filter.status = { $in: ['returned', 'refunded'] };
    else if (status === 'cancelled') filter.status = { $in: ['cancelled', 'canceled'] };
    const [headers, total, grouped] = await Promise.all([
      orders.find(filter, { projection: { signature: 0, memberId: 0 } })
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      orders.countDocuments(filter),
      orders.aggregate([
        { $match: allOrdersFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).toArray(),
    ]);
    const ids = headers.map(order => String(order._id));
    const lines = ids.length ? await this.db.collection<any>('orderItems')
      .find({ orderId: { $in: ids } }).sort({ orderId: 1, lineNumber: 1 }).toArray() : [];
    const productIds = [...new Set(lines.map(line => String(line.productId)).filter(id => Types.ObjectId.isValid(id)))];
    const products = productIds.length ? await this.db.collection<any>('products')
      .find({ _id: { $in: productIds.map(id => new Types.ObjectId(id)) } },
        { projection: { name: 1, imageUrl: 1, thumbnailUrl: 1, gallery: 1, sku: 1, saleUnit: 1 } }).toArray() : [];
    const productById = new Map(products.map(product => [String(product._id), product]));
    const byOrder = new Map<string, any[]>();
    for (const line of lines) {
      const key = String(line.orderId);
      const group = byOrder.get(key) ?? [];
      const product = productById.get(String(line.productId));
      group.push({
        ...line,
        image: product?.thumbnailUrl || product?.imageUrl || product?.gallery?.[0] || null,
        sku: product?.sku || null,
        unitPrice: { min: line.unitPrice.min / 1_000_000, max: line.unitPrice.max / 1_000_000 },
        lineSubtotal: { min: line.lineSubtotal.min / 1_000_000, max: line.lineSubtotal.max / 1_000_000 },
      });
      byOrder.set(key, group);
    }
    const counts = grouped.reduce((result, row) => {
      result[row._id] = row.count;
      return result;
    }, {} as Record<string, number>);
    const terminal = new Set(['creating', 'completed', 'returned', 'refunded', 'cancelled', 'canceled']);
    const current = Object.entries(counts).reduce((sum, [key, value]) => sum + (terminal.has(key) ? 0 : value), 0);
    return {
      items: headers.map(order => ({
        ...order, total: order.total / 1_000_000,
        subtotal: { min: order.subtotal.min / 1_000_000, max: order.subtotal.max / 1_000_000 },
        price: { min: order.price.min / 1_000_000, max: order.price.max / 1_000_000 },
        items: byOrder.get(String(order._id)) ?? [],
      })),
      counts: {
        current, completed: counts.completed || 0,
        returned: (counts.returned || 0) + (counts.refunded || 0),
        cancelled: (counts.cancelled || 0) + (counts.canceled || 0),
        total,
      },
      total, page, limit,
    };
  }

  async getOrder(memberId: Types.ObjectId, orderId: string) {
    await this.ensureIndexes();
    const order = await this.db.collection<any>('orders').findOne({ _id: orderId, memberId },
      { projection: { signature: 0, memberId: 0 } });
    if (!order) return null;
    const [lines, meta, events, logs] = await Promise.all([
      this.db.collection<any>('orderItems').find({ orderId }).sort({ lineNumber: 1 }).toArray(),
      this.db.collection<any>('orderMeta').findOne({ _id: orderId }),
      this.db.collection<any>('orderEvents').find({ orderId }).sort({ occurredAt: 1, _id: 1 }).toArray(),
      this.db.collection<any>('orderProcessingLogs').find({ orderId, status: 'succeeded' })
        .sort({ occurredAt: 1, _id: 1 }).toArray(),
    ]);
    const productIds = [...new Set(lines.map(line => String(line.productId)).filter(id => Types.ObjectId.isValid(id)))];
    const products = productIds.length ? await this.db.collection<any>('products')
      .find({ _id: { $in: productIds.map(id => new Types.ObjectId(id)) } },
        { projection: { name: 1, imageUrl: 1, thumbnailUrl: 1, gallery: 1, sku: 1, saleUnit: 1, description: 1, options: 1 } }).toArray() : [];
    const productById = new Map(products.map(product => [String(product._id), product]));
    const items = lines.map(line => {
      const product = productById.get(String(line.productId));
      return {
        ...line,
        image: product?.thumbnailUrl || product?.imageUrl || product?.gallery?.[0] || null,
        sku: product?.sku || null,
        specifications: product?.options || [],
        unitPrice: { min: line.unitPrice.min / 1_000_000, max: line.unitPrice.max / 1_000_000 },
        lineSubtotal: { min: line.lineSubtotal.min / 1_000_000, max: line.lineSubtotal.max / 1_000_000 },
      };
    });
    const asMoney = (range: any) => range ? { min: range.min / 1_000_000, max: range.max / 1_000_000 } : undefined;
    return {
      ...order,
      total: order.total / 1_000_000,
      subtotal: asMoney(order.subtotal),
      price: asMoney(order.price),
      items, meta,
      events: events.map(event => ({ type: event.type, fromStatus: event.fromStatus, toStatus: event.toStatus, occurredAt: event.occurredAt, payload: event.payload })),
      timeline: logs.map(log => ({ stage: log.stage, occurredAt: log.occurredAt, details: log.details })),
    };
  }

  private summary(order: any) {
    if (!order) throw new ConflictException('سفارش ذخیره نشد؛ دوباره تلاش کنید.');
    const asMoney = (range: any) => range ? { min: range.min / 1_000_000, max: range.max / 1_000_000 } : undefined;
    return { id: order._id, orderNumber: order.orderNumber, total: order.total / 1_000_000,
      currency: order.currency, price: asMoney(order.price), subtotal: asMoney(order.subtotal), status: order.status };
  }
}
