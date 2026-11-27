import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

type Actor = { id: Types.ObjectId | string; type: 'member' | 'system' | 'accounting' };
const STAGING_WAREHOUSE_ID = 'ACCOUNTING_STAGING';

@Injectable()
export class InventoryWorkflowService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  private async log(session: any, input: {
    orderId: string; stage: string; status: 'started' | 'succeeded' | 'failed';
    actor: Actor; correlationId: string; details?: Record<string, unknown>; error?: string;
  }) {
    await this.db.collection('orderProcessingLogs').insertOne({
      orderId: input.orderId, stage: input.stage, status: input.status,
      actor: input.actor, correlationId: input.correlationId,
      details: input.details ?? {}, error: input.error,
      occurredAt: new Date(), schemaVersion: 1,
    }, { session });
  }

  async stageOrder(orderId: string, sourceWarehouseId: string, actor: Actor, correlationId: string) {
    if (!sourceWarehouseId?.trim()) throw new BadRequestException('انبار مبدأ مشخص نشده است.');
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const orders = this.db.collection('orders');
        const order = await orders.findOne({ _id: orderId }, { session });
        if (!order) throw new NotFoundException('سفارش پیدا نشد.');
        if (!['pending', 'confirmed', 'awaiting_inventory'].includes(String(order.status))) {
          throw new ConflictException('وضعیت سفارش اجازه انتقال به انبار واسط را نمی‌دهد.');
        }
        const existing = await this.db.collection('inventoryReservations').find({ orderId }, { session }).toArray();
        if (existing.length) {
          if (existing.every(row => row.status === 'staged')) {
            result = { orderId, status: 'staged', idempotent: true };
            return;
          }
          throw new ConflictException('برای این سفارش رزرو یا انتقال نیمه‌تمام وجود دارد؛ ابتدا مغایرت‌یابی کنید.');
        }
        const items = await this.db.collection('orderItems').find({ orderId }).sort({ lineNumber: 1 }).session(session).toArray();
        if (!items.length) throw new ConflictException('سفارش فاقد ردیف محصول است.');
        await this.log(session, { orderId, stage: 'inventory.staging.started', status: 'started', actor, correlationId, details: { sourceWarehouseId, itemCount: items.length } });
        for (const item of items) {
          const quantity = Number(item.baseQuantity ?? item.quantity);
          if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new BadRequestException('تعداد ردیف سفارش معتبر نیست.');
          const balanceId = sourceWarehouseId + ':' + String(item.productId);
          const reserved = await this.db.collection('warehouseBalances').updateOne(
            { _id: balanceId, warehouseId: sourceWarehouseId, productId: String(item.productId),
              $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity] } },
            { $inc: { reserved: quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!reserved.modifiedCount) throw new ConflictException('موجودی قابل رزرو برای یکی از محصولات کافی نیست.');
          const reservationId = orderId + ':' + String(item.lineNumber);
          await this.db.collection('inventoryReservations').insertOne({
            _id: reservationId, orderId, orderItemId: item._id, lineNumber: item.lineNumber,
            productId: String(item.productId), sourceWarehouseId, stagingWarehouseId: STAGING_WAREHOUSE_ID,
            quantity, status: 'staged', createdBy: actor.id, createdAt: new Date(), schemaVersion: 1,
          }, { session });
          await this.db.collection('stagingWarehouseBalances').updateOne(
            { _id: STAGING_WAREHOUSE_ID + ':' + String(item.productId) },
            { $setOnInsert: { warehouseId: STAGING_WAREHOUSE_ID, productId: String(item.productId), createdAt: new Date() },
              $inc: { quantity, pendingAccounting: quantity }, $set: { updatedAt: new Date() } },
            { upsert: true, session },
          );
          await this.db.collection('inventoryMovements').insertOne({
            _id: reservationId + ':stage', orderId, orderItemId: item._id,
            productId: String(item.productId), quantity, movementType: 'reserve_for_accounting',
            fromWarehouseId: sourceWarehouseId, toWarehouseId: STAGING_WAREHOUSE_ID,
            actor, correlationId, occurredAt: new Date(), schemaVersion: 1,
          }, { session });
        }
        await orders.updateOne({ _id: orderId }, { $set: { inventoryStatus: 'staged', updatedAt: new Date() } }, { session });
        await this.log(session, { orderId, stage: 'inventory.staging.completed', status: 'succeeded', actor, correlationId, details: { sourceWarehouseId, stagingWarehouseId: STAGING_WAREHOUSE_ID, itemCount: items.length } });
        result = { orderId, status: 'staged', stagingWarehouseId: STAGING_WAREHOUSE_ID, itemCount: items.length };
      });
      return result;
    } catch (error: any) {
      await this.db.collection('orderProcessingLogs').insertOne({
        orderId, stage: 'inventory.staging.failed', status: 'failed', actor, correlationId,
        error: String(error?.message ?? error), occurredAt: new Date(), schemaVersion: 1,
      }).catch(() => undefined);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async confirmAccountingPosting(orderId: string, externalDocumentId: string, actor: Actor, correlationId: string) {
    if (!externalDocumentId?.trim()) throw new BadRequestException('شناسه سند حسابداری الزامی است.');
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const orders = this.db.collection('orders');
        const order = await orders.findOne({ _id: orderId }, { session });
        if (!order) throw new NotFoundException('سفارش پیدا نشد.');
        const meta = await this.db.collection('orderMeta').findOne({ _id: orderId }, { session });
        if (meta?.accounting?.syncStatus === 'synced') {
          if (meta.accounting.externalDocumentId !== externalDocumentId) throw new ConflictException('این سفارش قبلاً با سند حسابداری دیگری ثبت شده است.');
          result = { orderId, status: 'posted', idempotent: true };
          return;
        }
        const reservations = await this.db.collection('inventoryReservations').find({ orderId, status: 'staged' }, { session }).toArray();
        if (!reservations.length) throw new ConflictException('سفارش در انبار واسط موجودی قابل ثبت ندارد.');
        await this.log(session, { orderId, stage: 'accounting.posting.started', status: 'started', actor, correlationId, details: { externalDocumentId } });
        for (const row of reservations) {
          const balanceId = row.sourceWarehouseId + ':' + row.productId;
          const source = await this.db.collection('warehouseBalances').updateOne(
            { _id: balanceId, onHand: { $gte: row.quantity }, reserved: { $gte: row.quantity } },
            { $inc: { onHand: -row.quantity, reserved: -row.quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!source.modifiedCount) throw new ConflictException('موجودی انبار اصلی با رزرو ثبت‌شده مغایرت دارد.');
          const stagingId = row.stagingWarehouseId + ':' + row.productId;
          const staged = await this.db.collection('stagingWarehouseBalances').updateOne(
            { _id: stagingId, quantity: { $gte: row.quantity }, pendingAccounting: { $gte: row.quantity } },
            { $inc: { quantity: -row.quantity, pendingAccounting: -row.quantity }, $set: { updatedAt: new Date() } }, { session },
          );
          if (!staged.modifiedCount) throw new ConflictException('موجودی انبار واسط با سند سفارش مغایرت دارد.');
          await this.db.collection('inventoryReservations').updateOne({ _id: row._id, status: 'staged' },
            { $set: { status: 'posted', postedAt: new Date(), accountingDocumentId: externalDocumentId, updatedAt: new Date() } }, { session });
          await this.db.collection('inventoryMovements').insertOne({
            _id: row._id + ':accounted', orderId, orderItemId: row.orderItemId,
            productId: row.productId, quantity: row.quantity, movementType: 'accounting_issue',
            fromWarehouseId: row.sourceWarehouseId, toWarehouseId: null,
            accountingDocumentId: externalDocumentId, actor, correlationId,
            occurredAt: new Date(), schemaVersion: 1,
          }, { session });
        }
        await this.db.collection('orderMeta').updateOne({ _id: orderId },
          { $set: { 'accounting.externalDocumentId': externalDocumentId, 'accounting.syncStatus': 'synced',
            'accounting.syncedAt': new Date(), updatedAt: new Date() } }, { session });
        await orders.updateOne({ _id: orderId }, { $set: { inventoryStatus: 'posted_to_accounting', updatedAt: new Date() } }, { session });
        await this.log(session, { orderId, stage: 'accounting.posting.completed', status: 'succeeded', actor, correlationId, details: { externalDocumentId, lineCount: reservations.length } });
        result = { orderId, status: 'posted', externalDocumentId };
      });
      return result;
    } catch (error: any) {
      await this.db.collection('orderProcessingLogs').insertOne({
        orderId, stage: 'accounting.posting.failed', status: 'failed', actor, correlationId,
        error: String(error?.message ?? error), occurredAt: new Date(), schemaVersion: 1,
      }).catch(() => undefined);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async getOrderLogs(orderId: string) {
    return this.db.collection('orderProcessingLogs').find({ orderId }).sort({ occurredAt: 1, _id: 1 }).toArray();
  }
}
