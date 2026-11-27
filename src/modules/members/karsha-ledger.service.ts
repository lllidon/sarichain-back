import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession, Types } from 'mongoose';

const ANNUAL_DECAY_RATE = 0.002;
const PRECISION = 100_000_000;
const roundKarsha = (value: number) => Math.round(value * PRECISION) / PRECISION;
const duplicateKey = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
const monthlyRate = 1 - Math.pow(1 - ANNUAL_DECAY_RATE, 1 / 12);
const addMonthiversary = (anchor: Date, periods: number) => {
  const monthIndex = anchor.getUTCMonth() + periods;
  const year = anchor.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(anchor.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
};

@Injectable()
export class KarshaLedgerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get db() { if (!this.connection.db) throw new Error('MongoDB is not connected.'); return this.connection.db; }
  private get members() { return this.db.collection<any>('members'); }
  private get lots() { return this.db.collection<any>('karsha_wallet_lots'); }
  private get ledger() { return this.db.collection<any>('karsha_ledger'); }
  private get policies() { return this.db.collection<any>('karsha_policy'); }

  async onModuleInit() {
    await Promise.all([
      this.lots.createIndex({ memberId: 1, createdAt: 1, _id: 1 }),
      this.lots.createIndex({ nextDecayAt: 1, status: 1 }),
      this.lots.createIndex({ legacyMigrationKey: 1 }, { unique: true, sparse: true }),
      this.ledger.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true }),
      this.ledger.createIndex({ memberId: 1, createdAt: -1, _id: -1 }),
    ]);
    await this.readPolicy();
    // Catch up due month-anniversary charges after restart and periodically while the service is running.
    void this.sweepDueLots().catch(error => console.error('[karsha] Initial decay sweep failed:', error));
    this.timer = setInterval(() => void this.sweepDueLots().catch(error =>
      console.error('[karsha] Scheduled decay sweep failed:', error)), 6 * 60 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async readPolicy() {
    await this.policies.updateOne({ _id: 'default' }, { $setOnInsert: {
      _id: 'default', annualDecayRate: ANNUAL_DECAY_RATE, monthlyDecayRate: monthlyRate,
      rateTomanPerKarsha: 100_000, currency: 'TOMAN', createdAt: new Date(),
    } }, { upsert: true });
    // Establish the agreed default conversion without overwriting an explicitly configured rate.
    await this.policies.updateOne(
      { _id: 'default', $or: [{ rateTomanPerKarsha: null }, { rateTomanPerKarsha: { $exists: false } }] },
      { $set: { rateTomanPerKarsha: 100_000, currency: 'TOMAN', updatedAt: new Date() } },
    );
    const policy = await this.policies.findOne({ _id: 'default' });
    return { ...policy, annualDecayRate: ANNUAL_DECAY_RATE, monthlyDecayRate: monthlyRate };
  }

  async savePolicy(input: { rateTomanPerKarsha?: number | null }) {
    if (input.rateTomanPerKarsha !== undefined &&
      input.rateTomanPerKarsha !== null &&
      (!Number.isFinite(input.rateTomanPerKarsha) || input.rateTomanPerKarsha <= 0 || input.rateTomanPerKarsha > 1_000_000_000_000)) {
      throw new BadRequestException('نرخ هر کارسا باید عددی مثبت و معتبر به تومان باشد.');
    }
    const now = new Date();
    const fields: Record<string, unknown> = { annualDecayRate: ANNUAL_DECAY_RATE, monthlyDecayRate: monthlyRate, updatedAt: now };
    if (input.rateTomanPerKarsha !== undefined) fields.rateTomanPerKarsha = input.rateTomanPerKarsha;
    await this.policies.updateOne({ _id: 'default' }, { $set: fields, $setOnInsert: { createdAt: now, currency: 'TOMAN' } }, { upsert: true });
    return this.readPolicy();
  }

  private async inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => { result = await work(session); });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/Transaction numbers are only allowed|replica set|does not support transactions|mongos/i.test(message)) {
        throw new ConflictException('برای ثبت امن دفتر کل کارسا، MongoDB باید به‌صورت Replica Set اجرا شود. داده‌ای تغییر نکرده است.');
      }
      throw error;
    } finally { await session.endSession(); }
  }

  async credit(memberId: string, amount: number, options: { reason: string; actor?: string; idempotencyKey: string; kind?: string; markOnboarding?: boolean }) {
    this.validateAmount(amount);
    if (!options.reason?.trim() || options.reason.length > 300 || !options.idempotencyKey?.trim() || options.idempotencyKey.length > 180) {
      throw new BadRequestException('علت یا شناسه یکتای تراکنش معتبر نیست.');
    }
    const memberObjectId = new Types.ObjectId(memberId);
    await this.ensureLegacyLot(memberObjectId);
    await this.applyDueForMember(memberObjectId);
    const policy = await this.readPolicy();
    try {
      return await this.inTransaction(async session => {
      const existing = await this.ledger.findOne({ idempotencyKey: options.idempotencyKey }, { session });
      if (existing) return { duplicate: true, transaction: existing };
      const member = await this.members.findOne({ _id: memberObjectId }, { session });
      if (!member) throw new NotFoundException('عضو پیدا نشد.');
      if (options.markOnboarding && member.onboardingKarshaAwardedAt) {
        return { duplicate: true, alreadyAwarded: true, balance: Number(member.karshaBalance ?? 0) };
      }
      const now = new Date();
      const lotId = new Types.ObjectId();
      const balance = roundKarsha(Number(member.karshaBalance ?? 0) + amount);
      await this.lots.insertOne({ _id: lotId, memberId: memberObjectId, source: options.kind || 'credit',
        originalAmount: amount, remainingAmount: amount, createdAt: now, anchorAt: now, decayPeriods: 0,
        nextDecayAt: addMonthiversary(now, 1), status: 'active', createdBy: options.actor || null }, { session });
      const update: Record<string, unknown> = { $inc: { karshaBalance: amount }, $set: { updatedAt: now } };
      if (options.markOnboarding) update.$set = { updatedAt: now, onboardingKarshaAwardedAt: now };
      await this.members.updateOne({ _id: memberObjectId }, update, { session });
      const transaction = { _id: new Types.ObjectId(), memberId: memberObjectId, lotId, type: options.kind || 'credit',
        amount, balanceAfter: balance, reason: options.reason.trim(), actor: options.actor || null,
        idempotencyKey: options.idempotencyKey, createdAt: now, rateTomanPerKarsha: policy.rateTomanPerKarsha ?? null };
      await this.ledger.insertOne(transaction, { session });
      return { duplicate: false, transaction, balance };
      });
    } catch (error) {
      if (duplicateKey(error)) {
        const existing = await this.ledger.findOne({ idempotencyKey: options.idempotencyKey });
        if (existing) return { duplicate: true, transaction: existing };
      }
      throw error;
    }
  }

  async debit(memberId: string, amount: number, options: { reason: string; actor?: string; idempotencyKey: string; type?: string }) {
    this.validateAmount(amount);
    if (!options.reason?.trim() || options.reason.length > 300 || !options.idempotencyKey?.trim() || options.idempotencyKey.length > 180) {
      throw new BadRequestException('علت یا شناسه یکتای تراکنش معتبر نیست.');
    }
    const memberObjectId = new Types.ObjectId(memberId);
    await this.ensureLegacyLot(memberObjectId);
    await this.applyDueForMember(memberObjectId);
    const policy = await this.readPolicy();
    try {
      return await this.inTransaction(async session => {
      const existing = await this.ledger.findOne({ idempotencyKey: options.idempotencyKey }, { session });
      if (existing) return { duplicate: true, transaction: existing };
      const member = await this.members.findOne({ _id: memberObjectId }, { session });
      if (!member) throw new NotFoundException('عضو پیدا نشد.');
      const balanceBefore = roundKarsha(Number(member.karshaBalance ?? 0));
      if (balanceBefore + 1 / PRECISION < amount) throw new BadRequestException('موجودی کارسا کافی نیست.');
      let lots = await this.lots.find({ memberId: memberObjectId, remainingAmount: { $gt: 0 } }, { session }).sort({ createdAt: 1, _id: 1 }).toArray();
      const lotBalance = roundKarsha(lots.reduce((sum, lot) => sum + Number(lot.remainingAmount || 0), 0));
      if (Math.abs(lotBalance - balanceBefore) > 1 / PRECISION) {
        throw new ConflictException('موجودی و سهمیه‌های دفتر کل هم‌خوان نیستند؛ ابتدا تطبیق کیف پول انجام دهید.');
      }
      let remaining = amount;
      const allocations: Array<{ lotId: Types.ObjectId; amount: number }> = [];
      for (const lot of lots) {
        if (remaining <= 1 / PRECISION) break;
        const available = Number(lot.remainingAmount || 0);
        const used = roundKarsha(Math.min(available, remaining));
        if (used <= 0) continue;
        const result = await this.lots.updateOne({ _id: lot._id, remainingAmount: available },
          { $set: { remainingAmount: roundKarsha(available - used), status: available - used <= 1 / PRECISION ? 'consumed' : 'active', updatedAt: new Date() } }, { session });
        if (!result.modifiedCount) throw new ConflictException('سهمیه کارسا هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.');
        allocations.push({ lotId: lot._id, amount: used });
        remaining = roundKarsha(remaining - used);
      }
      if (remaining > 1 / PRECISION) throw new ConflictException('تخصیص FIFO کامل نشد؛ موجودی و سهمیه‌ها نیازمند تطبیق هستند.');
      const balanceAfter = roundKarsha(balanceBefore - amount);
      const changed = await this.members.updateOne({ _id: memberObjectId, karshaBalance: { $gte: amount } },
        { $inc: { karshaBalance: -amount }, $set: { updatedAt: new Date() } }, { session });
      if (!changed.modifiedCount) throw new ConflictException('موجودی هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.');
      const transaction = { _id: new Types.ObjectId(), memberId: memberObjectId, type: options.type || 'debit',
        amount: -amount, balanceAfter, reason: options.reason.trim(), actor: options.actor || null,
        allocations, idempotencyKey: options.idempotencyKey, createdAt: new Date(),
        rateTomanPerKarsha: policy.rateTomanPerKarsha ?? null };
      await this.ledger.insertOne(transaction, { session });
      return { duplicate: false, transaction, balance: balanceAfter };
      });
    } catch (error) {
      if (duplicateKey(error)) {
        const existing = await this.ledger.findOne({ idempotencyKey: options.idempotencyKey });
        if (existing) return { duplicate: true, transaction: existing };
      }
      throw error;
    }
  }

  private validateAmount(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || roundKarsha(amount) !== amount) {
      throw new BadRequestException('مقدار کارسا باید مثبت و حداکثر با ۸ رقم اعشار باشد.');
    }
  }

  private async applyDueForMember(memberId: Types.ObjectId) {
    const now = new Date();
    while (true) {
      const due = await this.lots.findOne({ memberId, status: 'active', remainingAmount: { $gt: 0 }, nextDecayAt: { $lte: now } },
        { sort: { nextDecayAt: 1, createdAt: 1 } });
      if (!due) break;
      const policy = await this.readPolicy();
      await this.inTransaction(async session => {
        const lot = await this.lots.findOne({ _id: due._id, status: 'active', nextDecayAt: { $lte: now } }, { session });
        if (!lot) return;
        const nextPeriods = Number(lot.decayPeriods || 0) + 1;
        const nextDate = addMonthiversary(new Date(lot.anchorAt || lot.createdAt), nextPeriods);
        const before = roundKarsha(Number(lot.remainingAmount || 0));
        const charge = roundKarsha(before * monthlyRate);
        const after = Math.max(0, roundKarsha(before - charge));
        await this.lots.updateOne({ _id: lot._id, nextDecayAt: lot.nextDecayAt },
          { $set: { remainingAmount: after, decayPeriods: nextPeriods, nextDecayAt: nextDate,
            status: after <= 0 ? 'consumed' : 'active', updatedAt: now } }, { session });
        if (charge > 0) {
          const member = await this.members.findOne({ _id: memberId }, { session });
          if (!member) throw new NotFoundException('عضو پیدا نشد.');
          const memberBalance = roundKarsha(Number(member.karshaBalance || 0));
          if (memberBalance + 1 / PRECISION < charge) throw new ConflictException('موجودی کیف پول با سهمیه کارسا هم‌خوان نیست؛ کاهش ماهانه متوقف شد.');
          const balanceAfter = Math.max(0, roundKarsha(memberBalance - charge));
          await this.members.updateOne({ _id: memberId }, { $set: { karshaBalance: balanceAfter, updatedAt: now } }, { session });
          const idempotencyKey = 'decay:' + lot._id.toString() + ':' + nextPeriods;
          await this.ledger.updateOne({ idempotencyKey }, { $setOnInsert: {
            _id: new Types.ObjectId(), memberId, lotId: lot._id, type: 'decay', amount: -charge,
            balanceAfter, reason: 'کاهش ماهانه کارسا طبق سیاست ۰٫۲ درصد سالانه', actor: 'system',
            idempotencyKey, createdAt: now, rateTomanPerKarsha: policy.rateTomanPerKarsha ?? null,
          } }, { upsert: true, session });
        }
      });
    }
  }

  private async ensureLegacyLot(memberId: Types.ObjectId) {
    const current = await this.members.findOne({ _id: memberId }, { projection: { karshaBalance: 1 } });
    if (!current || Number(current.karshaBalance ?? 0) <= 0) return;
    const policy = await this.readPolicy();
    try {
      await this.inTransaction(async session => {
      const member = await this.members.findOne({ _id: memberId }, { session });
      if (!member) return;
      const sum = await this.lots.aggregate(
        [{ $match: { memberId } }, { $group: { _id: null, total: { $sum: '$remainingAmount' } } }],
        { session },
      ).toArray();
      const existing = await this.lots.findOne({ legacyMigrationKey: memberId.toString() }, { session });
      const balance = roundKarsha(Number(member.karshaBalance ?? 0));
      const tracked = roundKarsha(Number(sum[0]?.total ?? 0));
      const difference = roundKarsha(balance - tracked);
      if (difference < -1 / PRECISION) throw new ConflictException('مجموع سهمیه‌های کارسا از موجودی کیف پول بیشتر است؛ تطبیق مدیریتی لازم است.');
      if (difference <= 1 / PRECISION) return;
      const now = new Date();
      const lotId = existing?._id ?? new Types.ObjectId();
      if (existing) {
        await this.lots.updateOne({ _id: existing._id }, { $inc: { originalAmount: difference, remainingAmount: difference },
          $set: { updatedAt: now, status: 'active' } }, { session });
      } else {
        await this.lots.insertOne({ _id: lotId, memberId, source: 'legacy_migration',
          legacyMigrationKey: memberId.toString(), originalAmount: difference, remainingAmount: difference,
          createdAt: now, anchorAt: now, decayPeriods: 0, nextDecayAt: addMonthiversary(now, 1),
          status: 'active', createdBy: 'system' }, { session });
      }
      await this.ledger.insertOne({ _id: new Types.ObjectId(), memberId, lotId, type: 'migration',
        amount: difference, balanceAfter: balance, reason: 'انتقال موجودی قبلی به دفتر کل کارسا',
        actor: 'system', idempotencyKey: 'legacy-migration:' + memberId.toString() + ':' + now.getTime(),
        createdAt: now, rateTomanPerKarsha: policy.rateTomanPerKarsha ?? null }, { session });
      });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
    }
  }

  async sweepDueLots() {
    const members = await this.members.find({ karshaBalance: { $gt: 0 } }, { projection: { _id: 1 } }).toArray();
    for (const member of members) await this.ensureLegacyLot(member._id);
    const dueMembers = await this.lots.distinct('memberId', { status: 'active', remainingAmount: { $gt: 0 }, nextDecayAt: { $lte: new Date() } });
    for (const memberId of dueMembers) await this.applyDueForMember(memberId);
    return { processedMembers: dueMembers.length };
  }

  async summary(memberId: string) {
    const id = new Types.ObjectId(memberId);
    await this.ensureLegacyLot(id);
    await this.applyDueForMember(id);
    const [member, policy, lots, transactions] = await Promise.all([
      this.members.findOne({ _id: id }, { projection: { karshaBalance: 1, onboardingKarshaAwardedAt: 1 } }),
      this.readPolicy(),
      this.lots.find({ memberId: id, remainingAmount: { $gt: 0 } }).sort({ createdAt: 1 }).toArray(),
      this.ledger.find({ memberId: id }).sort({ createdAt: -1, _id: -1 }).limit(20).toArray(),
    ]);
    return { balance: Number(member?.karshaBalance ?? 0), rateTomanPerKarsha: policy.rateTomanPerKarsha ?? null,
      equivalentToman: policy.rateTomanPerKarsha == null ? null : roundKarsha(Number(member?.karshaBalance ?? 0) * policy.rateTomanPerKarsha),
      annualDecayRate: ANNUAL_DECAY_RATE, monthlyDecayRate: monthlyRate, nextDecayAt: lots.length ? lots.reduce((min, lot) =>
        !min || new Date(lot.nextDecayAt) < new Date(min) ? lot.nextDecayAt : min, null as Date | null) : null,
      lots: lots.map(lot => ({ id: lot._id, source: lot.source, originalAmount: lot.originalAmount,
        remainingAmount: lot.remainingAmount, createdAt: lot.createdAt, nextDecayAt: lot.nextDecayAt })),
      transactions, onboardingKarshaAwarded: Boolean(member?.onboardingKarshaAwardedAt) };
  }

  async listTransactions(memberId: string, page = 1, limit = 20) {
    const id = new Types.ObjectId(memberId);
    await this.ensureLegacyLot(id);
    await this.applyDueForMember(id);
    const [items, total] = await Promise.all([
      this.ledger.find({ memberId: id }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.ledger.countDocuments({ memberId: id }),
    ]);
    return { items, total, page, limit };
  }

  async adminLedger(query: { memberId?: string; page?: number; limit?: number }) {
    await this.sweepDueLots();
    const filter = query.memberId && Types.ObjectId.isValid(query.memberId) ? { memberId: new Types.ObjectId(query.memberId) } : {};
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const [items, total] = await Promise.all([
      this.ledger.aggregate([{ $match: filter }, { $sort: { createdAt: -1, _id: -1 } },
        { $skip: (page - 1) * limit }, { $limit: limit },
        { $lookup: { from: 'members', localField: 'memberId', foreignField: '_id', as: 'member' } },
        { $unwind: { path: '$member', preserveNullAndEmptyArrays: true } },
        { $project: { memberId: 1, type: 1, amount: 1, balanceAfter: 1, reason: 1, actor: 1, createdAt: 1,
          allocations: 1, rateTomanPerKarsha: 1, 'member.fullName': 1, 'member.phone': 1, 'member.organization': 1 } },
      ]).toArray(),
      this.ledger.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
}
