import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

type Actor = { id: Types.ObjectId | string; type: 'member' | 'system' | 'accounting' };
const STAGING_WAREHOUSE_ID = 'ACCOUNTING_STAGING';

@Injectable()
export class InventoryWorkflowService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  private async ensureIndexes() {
    await Promise.all([
      this.db.collection<any>('inventoryReservations').createIndex({ orderId: 1, status: 1 }, { name: 'ix_inventory_reservations_order_status' }),
      this.db.collection<any>('inventoryMovements').createIndex({ orderId: 1, occurredAt: 1 }, { name: 'ix_inventory_movements_order_time' }),
      this.db.collection<any>('stagingWarehouseBalances').createIndex({ warehouseId: 1, productId: 1 }, { unique: true, name: 'uq_staging_product_balance' }),
      this.db.collection<any>('orderProcessingLogs').createIndex({ orderId: 1, occurredAt: 1 }, { name: 'ix_order_processing_logs_timeline' }),
      this.db.collection<any>('accountingOutbox').createIndex({ status: 1, createdAt: 1 }, { name: 'ix_accounting_outbox_status_created' }),
    ]);
  }

  async getStagingBalances() {
    await this.ensureIndexes();
    return this.db.collection<any>('stagingWarehouseBalances').find({ warehouseId: STAGING_WAREHOUSE_ID })
      .sort({ productId: 1 }).toArray();
  }

  private async log(session: any, input: {
    orderId: string; stage: string; status: 'started' | 'succeeded' | 'failed';
    actor: Actor; correlationId: string; details?: Record<string, unknown>; error?: string;
  }) {
    await this.db.collection<any>('orderProcessingLogs').insertOne({
      orderId: input.orderId, stage: input.stage, status: input.status,
      actor: input.actor, correlationId: input.correlationId,
      details: input.details ?? {}, error: input.error,
      occurredAt: new Date(), schemaVersion: 1,
    }, { session });
  }

  async stageOrder(orderId: string, actor: Actor, correlationId: string) {
    await this.ensureIndexes();
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const order = await this.db.collection<any>('orders').findOne({ _id: orderId }, { session });
        if (!order) throw new NotFoundException('سفارش پیدا نشد.');
        if (!['pending', 'confirmed', 'awaiting_inventory'].includes(String(order.status))) {
          throw new ConflictException('وضعیت سفارش اجازه رزرو موجودی را نمی‌دهد.');
        }
        const existing = await this.db.collection<any>('inventoryReservations').find({ orderId }, { session }).toArray();
        if (existing.length) {
          if (existing.every(row => row.status === 'staged')) {
            result = { orderId, status: 'staged', idempotent: true };
            return;
          }
          throw new ConflictException('برای این سفارش رزرو یا انتقال نیمه‌تمام وجود دارد؛ ابتدا مغایرت‌یابی کنید.');
        }
        const items = await this.db.collection<any>('orderItems').find({ orderId }, { session }).sort({ lineNumber: 1 }).toArray();
        if (!items.length) throw new ConflictException('سفارش فاقد ردیف محصول است.');
        await this.log(session, { orderId, stage: 'inventory.seller_stock_reservation.started', status: 'started', actor, correlationId, details: { itemCount: items.length } });
        for (const item of items) {
          const quantity = Number(item.baseQuantity ?? item.quantity);
          if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Types.ObjectId.isValid(String(item.offerId)) || !Types.ObjectId.isValid(String(item.sellerId))) {
            throw new BadRequestException('اطلاعات پیشنهاد فروشنده یا تعداد سفارش معتبر نیست.');
          }
          const offerId = new Types.ObjectId(String(item.offerId));
          const sellerId = new Types.ObjectId(String(item.sellerId));
          const productId = new Types.ObjectId(String(item.productId));
          const offerFilter = { _id: offerId, section: 'products', memberId: sellerId, 'offer.productId': productId,
            $expr: { $gte: [{ $subtract: ['$offer.stock', { $ifNull: ['$offer.reservedStock', 0] }] }, quantity] } };
          const reserved = await this.db.collection<any>('web_workspace_entries').updateOne(
            offerFilter, { $inc: { 'offer.reservedStock': quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!reserved.modifiedCount) throw new ConflictException('موجودی قابل سفارش این فروشنده برای محصول کافی نیست.');
          const reservationId = orderId + ':' + String(item.lineNumber);
          await this.db.collection<any>('inventoryReservations').insertOne({
            _id: reservationId, orderId, orderItemId: item._id, lineNumber: item.lineNumber,
            productId: String(item.productId), sellerId: String(item.sellerId), offerId: String(item.offerId),
            quantity, status: 'staged', createdBy: actor.id, createdAt: new Date(), schemaVersion: 2,
          }, { session });
          await this.db.collection<any>('stagingWarehouseBalances').updateOne(
            { _id: STAGING_WAREHOUSE_ID + ':' + String(item.productId) },
            { $setOnInsert: { warehouseId: STAGING_WAREHOUSE_ID, productId: String(item.productId), createdAt: new Date() },
              $inc: { quantity, pendingAccounting: quantity }, $set: { updatedAt: new Date() } },
            { upsert: true, session },
          );
          await this.db.collection<any>('inventoryMovements').insertOne({
            _id: reservationId + ':stage', orderId, orderItemId: item._id,
            productId: String(item.productId), sellerId: String(item.sellerId), offerId: String(item.offerId),
            quantity, movementType: 'reserve_seller_stock_for_accounting',
            fromWarehouseId: 'SELLER:' + String(item.sellerId), toWarehouseId: STAGING_WAREHOUSE_ID,
            actor, correlationId, occurredAt: new Date(), schemaVersion: 2,
          }, { session });
        }
        await this.db.collection<any>('accountingOutbox').updateOne(
          { _id: 'order:' + orderId },
          { $setOnInsert: { orderId, eventType: 'order.inventory.staged', status: 'pending', attempts: 0, createdAt: new Date(), schemaVersion: 1 } },
          { upsert: true, session },
        );
        await this.db.collection<any>('orderMeta').updateOne({ _id: orderId },
          { $set: { 'inventory.status': 'staged', 'inventory.source': 'seller_offers',
            'inventory.stagingWarehouseId': STAGING_WAREHOUSE_ID, updatedAt: new Date() } }, { session });
        await this.db.collection<any>('orders').updateOne({ _id: orderId }, { $set: { inventoryStatus: 'staged', updatedAt: new Date() } }, { session });
        await this.log(session, { orderId, stage: 'inventory.seller_stock_reservation.completed', status: 'succeeded', actor, correlationId, details: { stagingWarehouseId: STAGING_WAREHOUSE_ID, itemCount: items.length } });
        result = { orderId, status: 'staged', stagingWarehouseId: STAGING_WAREHOUSE_ID, itemCount: items.length };
      });
      return result;
    } catch (error: any) {
      await this.db.collection<any>('orderProcessingLogs').insertOne({
        orderId, stage: 'inventory.seller_stock_reservation.failed', status: 'failed', actor, correlationId,
        error: String(error?.message ?? error), occurredAt: new Date(), schemaVersion: 1,
      }).catch(() => undefined);
      throw error;
    } finally { await session.endSession(); }
  }

  async releaseStagedOrder(orderId: string, reason: string, actor: Actor, correlationId: string) {
    if (!reason?.trim()) throw new BadRequestException('علت آزادسازی رزرو الزامی است.');
    await this.ensureIndexes();
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const order = await this.db.collection<any>('orders').findOne({ _id: orderId }, { session });
        if (!order) throw new NotFoundException('سفارش پیدا نشد.');
        if (order.inventoryStatus === 'posted_to_accounting') {
          throw new ConflictException('سفارش ثبت‌شده در حسابداری قابل آزادسازی رزرو نیست؛ باید سند برگشت یا اصلاح صادر شود.');
        }
        const rows = await this.db.collection<any>('inventoryReservations').find({ orderId, status: 'staged' }, { session }).toArray();
        if (!rows.length) {
          if (order.inventoryStatus === 'released' || order.inventoryStatus === 'not_reserved') {
            result = { orderId, status: order.inventoryStatus, idempotent: true };
            return;
          }
          throw new ConflictException('رزرو فعال برای این سفارش پیدا نشد.');
        }
        await this.log(session, { orderId, stage: 'inventory.reservation_release.started', status: 'started', actor, correlationId, details: { reason } });
        for (const row of rows) {
          const source = await this.db.collection<any>('web_workspace_entries').updateOne(
            { _id: new Types.ObjectId(row.offerId), memberId: new Types.ObjectId(row.sellerId),
              section: 'products', 'offer.productId': new Types.ObjectId(row.productId),
              'offer.reservedStock': { $gte: row.quantity } },
            { $inc: { 'offer.reservedStock': -row.quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!source.modifiedCount) throw new ConflictException('رزرو موجودی فروشنده با سوابق مغایرت دارد.');
          const staging = await this.db.collection<any>('stagingWarehouseBalances').updateOne(
            { _id: row.stagingWarehouseId + ':' + row.productId, quantity: { $gte: row.quantity }, pendingAccounting: { $gte: row.quantity } },
            { $inc: { quantity: -row.quantity, pendingAccounting: -row.quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!staging.modifiedCount) throw new ConflictException('موجودی انبار واسط با سوابق رزرو مغایرت دارد.');
          await this.db.collection<any>('inventoryReservations').updateOne({ _id: row._id, status: 'staged' },
            { $set: { status: 'released', releasedAt: new Date(), releaseReason: reason, updatedAt: new Date() } }, { session });
          await this.db.collection<any>('inventoryMovements').insertOne({
            _id: row._id + ':released', orderId, orderItemId: row.orderItemId,
            productId: row.productId, quantity: row.quantity, movementType: 'release_reservation',
            fromWarehouseId: row.stagingWarehouseId, toWarehouseId: 'SELLER:' + row.sellerId,
            sellerId: row.sellerId, offerId: row.offerId,
            actor, correlationId, reason, occurredAt: new Date(), schemaVersion: 1,
          }, { session });
        }
        await this.db.collection<any>('accountingOutbox').updateOne({ _id: 'order:' + orderId },
          { $set: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: reason, updatedAt: new Date() } }, { session });
        await this.db.collection<any>('orderMeta').updateOne({ _id: orderId },
          { $set: { 'inventory.status': 'released', 'inventory.releaseReason': reason, updatedAt: new Date() } }, { session });
        await this.db.collection<any>('orders').updateOne({ _id: orderId },
          { $set: { inventoryStatus: 'released', updatedAt: new Date() } }, { session });
        await this.log(session, { orderId, stage: 'inventory.reservation_release.completed', status: 'succeeded', actor, correlationId, details: { reason, lineCount: rows.length } });
        result = { orderId, status: 'released', lineCount: rows.length };
      });
      return result;
    } catch (error: any) {
      await this.db.collection<any>('orderProcessingLogs').insertOne({
        orderId, stage: 'inventory.reservation_release.failed', status: 'failed', actor, correlationId,
        error: String(error?.message ?? error), occurredAt: new Date(), schemaVersion: 1,
      }).catch(() => undefined);
      throw error;
    } finally { await session.endSession(); }
  }

  async confirmAccountingPosting(orderId: string, externalDocumentId: string, actor: Actor, correlationId: string) {
    if (!externalDocumentId?.trim()) throw new BadRequestException('شناسه سند حسابداری الزامی است.');
    await this.ensureIndexes();
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const orders = this.db.collection<any>('orders');
        const order = await orders.findOne({ _id: orderId }, { session });
        if (!order) throw new NotFoundException('سفارش پیدا نشد.');
        const meta = await this.db.collection<any>('orderMeta').findOne({ _id: orderId }, { session });
        if (meta?.accounting?.syncStatus === 'synced') {
          if (meta.accounting.externalDocumentId !== externalDocumentId) throw new ConflictException('این سفارش قبلاً با سند حسابداری دیگری ثبت شده است.');
          result = { orderId, status: 'posted', idempotent: true };
          return;
        }
        const reservations = await this.db.collection<any>('inventoryReservations').find({ orderId, status: 'staged' }, { session }).toArray();
        if (!reservations.length) throw new ConflictException('سفارش در انبار واسط موجودی قابل ثبت ندارد.');
        await this.log(session, { orderId, stage: 'accounting.posting.started', status: 'started', actor, correlationId, details: { externalDocumentId } });
        for (const row of reservations) {
          const source = await this.db.collection<any>('web_workspace_entries').updateOne(
            { _id: new Types.ObjectId(row.offerId), memberId: new Types.ObjectId(row.sellerId),
              section: 'products', 'offer.productId': new Types.ObjectId(row.productId),
              'offer.stock': { $gte: row.quantity }, 'offer.reservedStock': { $gte: row.quantity } },
            { $inc: { 'offer.stock': -row.quantity, 'offer.reservedStock': -row.quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!source.modifiedCount) throw new ConflictException('موجودی پیشنهاد فروشنده با رزرو ثبت‌شده مغایرت دارد.');
          const stagingId = row.stagingWarehouseId + ':' + row.productId;
          const staged = await this.db.collection<any>('stagingWarehouseBalances').updateOne(
            { _id: stagingId, quantity: { $gte: row.quantity }, pendingAccounting: { $gte: row.quantity } },
            { $inc: { quantity: -row.quantity, pendingAccounting: -row.quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!staged.modifiedCount) throw new ConflictException('موجودی انبار واسط با سند سفارش مغایرت دارد.');
          await this.db.collection<any>('inventoryReservations').updateOne({ _id: row._id, status: 'staged' },
            { $set: { status: 'posted', postedAt: new Date(), accountingDocumentId: externalDocumentId, updatedAt: new Date() } }, { session });
          await this.db.collection<any>('inventoryMovements').insertOne({
            _id: row._id + ':accounted', orderId, orderItemId: row.orderItemId,
            productId: row.productId, quantity: row.quantity, movementType: 'accounting_issue',
            fromWarehouseId: 'SELLER:' + row.sellerId, toWarehouseId: null,
            sellerId: row.sellerId, offerId: row.offerId,
            accountingDocumentId: externalDocumentId, actor, correlationId,
            occurredAt: new Date(), schemaVersion: 1,
          }, { session });
        }
        await this.db.collection<any>('orderMeta').updateOne({ _id: orderId },
          { $set: { 'accounting.externalDocumentId': externalDocumentId, 'accounting.syncStatus': 'synced',
            'accounting.syncedAt': new Date(), updatedAt: new Date() } }, { session });
        await this.db.collection<any>('accountingOutbox').updateOne(
          { _id: 'order:' + orderId },
          { $set: { status: 'completed', externalDocumentId, completedAt: new Date(), updatedAt: new Date() } },
          { session },
        );
        await this.db.collection<any>('orderMeta').updateOne({ _id: orderId },
          { $set: { 'inventory.status': 'posted_to_accounting', 'inventory.postedAt': new Date(), updatedAt: new Date() } }, { session });
        await orders.updateOne({ _id: orderId }, { $set: { inventoryStatus: 'posted_to_accounting', updatedAt: new Date() } }, { session });
        await this.log(session, { orderId, stage: 'accounting.posting.completed', status: 'succeeded', actor, correlationId, details: { externalDocumentId, lineCount: reservations.length } });
        result = { orderId, status: 'posted', externalDocumentId };
      });
      return result;
    } catch (error: any) {
      await this.db.collection<any>('orderProcessingLogs').insertOne({
        orderId, stage: 'accounting.posting.failed', status: 'failed', actor, correlationId,
        error: String(error?.message ?? error), occurredAt: new Date(), schemaVersion: 1,
      }).catch(() => undefined);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async getMovements(filters: { orderId?: string; productId?: string; warehouseId?: string; limit?: number }) {
    await this.ensureIndexes();
    const query: Record<string, unknown> = {};
    if (filters.orderId) query.orderId = filters.orderId;
    if (filters.productId) query.productId = filters.productId;
    if (filters.warehouseId) query.$or = [{ fromWarehouseId: filters.warehouseId }, { toWarehouseId: filters.warehouseId }];
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    return this.db.collection<any>('inventoryMovements').find(query).sort({ occurredAt: -1, _id: -1 }).limit(limit).toArray();
  }

  async getOrderLogs(orderId: string) {
    return this.db.collection<any>('orderProcessingLogs').find({ orderId }).sort({ occurredAt: 1, _id: 1 }).toArray();
  }
}
