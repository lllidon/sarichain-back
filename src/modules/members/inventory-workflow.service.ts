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
      this.db.collection('warehouseBalances').createIndex({ warehouseId: 1, productId: 1 }, { unique: true, name: 'uq_warehouse_product_balance' }),
      this.db.collection('inventoryReservations').createIndex({ orderId: 1, status: 1 }, { name: 'ix_inventory_reservations_order_status' }),
      this.db.collection('inventoryMovements').createIndex({ orderId: 1, occurredAt: 1 }, { name: 'ix_inventory_movements_order_time' }),
      this.db.collection('stagingWarehouseBalances').createIndex({ warehouseId: 1, productId: 1 }, { unique: true, name: 'uq_staging_product_balance' }),
      this.db.collection('orderProcessingLogs').createIndex({ orderId: 1, occurredAt: 1 }, { name: 'ix_order_processing_logs_timeline' }),
      this.db.collection('accountingOutbox').createIndex({ status: 1, createdAt: 1 }, { name: 'ix_accounting_outbox_status_created' }),
    ]);
  }

  async createWarehouse(input: { id: string; name: string; type: 'main' | 'staging'; actor: Actor }) {
    await this.ensureIndexes();
    if (!input.id.trim() || !input.name.trim()) throw new BadRequestException('شناسه و نام انبار الزامی است.');
    if ((input.id === STAGING_WAREHOUSE_ID) !== (input.type === 'staging')) throw new BadRequestException('شناسه انبار واسط رزروشده است و فقط با نوع staging قابل استفاده است.');
    const previous = await this.db.collection('warehouses').findOne({ _id: input.id });
    if (previous && (previous.type !== input.type || previous.name !== input.name.trim())) throw new ConflictException('مشخصات انبار موجود قابل تغییر نیست؛ شناسه دیگری انتخاب کنید.');
    await this.db.collection('warehouses').updateOne({ _id: input.id }, {
      $setOnInsert: { name: input.name.trim(), type: input.type, isActive: true, createdAt: new Date(), createdBy: input.actor.id, schemaVersion: 1 },
    }, { upsert: true });
    return this.db.collection('warehouses').findOne({ _id: input.id });
  }

  async setOpeningBalance(input: { warehouseId: string; productId: string; quantity: number; actor: Actor; correlationId: string }) {
    await this.ensureIndexes();
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) throw new BadRequestException('موجودی اولیه باید عدد صحیح نامنفی باشد.');
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const warehouse = await this.db.collection('warehouses').findOne({ _id: input.warehouseId, isActive: true }, { session });
        if (!warehouse) throw new NotFoundException('انبار فعال پیدا نشد.');
        const id = input.warehouseId + ':' + input.productId;
        const existing = await this.db.collection('warehouseBalances').findOne({ _id: id }, { session });
        if (existing) throw new ConflictException('موجودی اولیه قبلاً ثبت شده است؛ برای اصلاح از سند تعدیل موجودی استفاده کنید.');
        await this.db.collection('warehouseBalances').insertOne({
          _id: id, warehouseId: input.warehouseId, productId: input.productId,
          onHand: input.quantity, reserved: 0, updatedAt: new Date(), createdAt: new Date(), schemaVersion: 1,
        }, { session });
        await this.db.collection('inventoryMovements').insertOne({
          _id: 'opening:' + id, productId: input.productId, quantity: input.quantity,
          movementType: 'opening_balance', toWarehouseId: input.warehouseId,
          actor: input.actor, correlationId: input.correlationId, occurredAt: new Date(), schemaVersion: 1,
        }, { session });
      });
      return { warehouseId: input.warehouseId, productId: input.productId, onHand: input.quantity, reserved: 0 };
    } finally { await session.endSession(); }
  }

  async getBalances(warehouseId: string) {
    await this.ensureIndexes();
    const rows = await this.db.collection('warehouseBalances').find({ warehouseId }).sort({ productId: 1 }).toArray();
    return rows.map(row => ({ ...row, available: row.onHand - row.reserved }));
  }

  async getStagingBalances() {
    await this.ensureIndexes();
    return this.db.collection('stagingWarehouseBalances').find({ warehouseId: STAGING_WAREHOUSE_ID })
      .sort({ productId: 1 }).toArray();
  }

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
    await this.ensureIndexes();
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const orders = this.db.collection('orders');
        const order = await orders.findOne({ _id: orderId }, { session });
        if (!order) throw new NotFoundException('سفارش پیدا نشد.');
        const sourceWarehouse = await this.db.collection('warehouses').findOne({ _id: sourceWarehouseId, type: 'main', isActive: true }, { session });
        if (!sourceWarehouse) throw new NotFoundException('انبار اصلی فعال پیدا نشد.');
        await this.db.collection('warehouses').updateOne(
          { _id: STAGING_WAREHOUSE_ID },
          { $setOnInsert: { name: 'انبار واسط حسابداری', type: 'staging', isActive: true, createdAt: new Date(), schemaVersion: 1 } },
          { upsert: true, session },
        );
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
        const items = await this.db.collection('orderItems').find({ orderId }, { session }).sort({ lineNumber: 1 }).toArray();
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
        await this.db.collection('accountingOutbox').updateOne(
          { _id: 'order:' + orderId },
          { $setOnInsert: { orderId, eventType: 'order.inventory.staged', status: 'pending',
            attempts: 0, createdAt: new Date(), schemaVersion: 1 } },
          { upsert: true, session },
        );
        await this.db.collection('orderMeta').updateOne({ _id: orderId },
          { $set: { 'inventory.status': 'staged', 'inventory.sourceWarehouseId': sourceWarehouseId,
            'inventory.stagingWarehouseId': STAGING_WAREHOUSE_ID, updatedAt: new Date() } }, { session });
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
    await this.ensureIndexes();
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
        await this.db.collection('accountingOutbox').updateOne(
          { _id: 'order:' + orderId },
          { $set: { status: 'completed', externalDocumentId, completedAt: new Date(), updatedAt: new Date() } },
          { session },
        );
        await this.db.collection('orderMeta').updateOne({ _id: orderId },
          { $set: { 'inventory.status': 'posted_to_accounting', 'inventory.postedAt': new Date(), updatedAt: new Date() } }, { session });
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
