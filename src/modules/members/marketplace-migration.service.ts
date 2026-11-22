import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { normalizePhone, mobileNumberPattern } from '../auth/phone';
import { User } from '../auth/schemas/user.schema';
import { MarketplaceMember, MemberPhone } from './member.schemas';
import { MemberGroup, memberTypes, needsSpecialistReview } from './member-types';

const sources = [
  ['customers', MemberGroup.Customers],
  ['producers', MemberGroup.Producers],
  ['service_providers', MemberGroup.Services],
] as const;
const commonFields = ['fullName', 'email', 'organization', 'province', 'city', 'provinceCode', 'cityCode', 'address', 'notes', 'isActive', 'branchId', 'createdAt', 'updatedAt'];

@Injectable()
export class MarketplaceMigration {
  constructor(
    @InjectModel(MarketplaceMember.name) private readonly market: Model<MarketplaceMember>,
    @InjectModel(MemberPhone.name) private readonly registry: Model<MemberPhone>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async run() {
    const database = this.market.db.db;
    if (!database) throw new Error('MongoDB is not connected.');
    const migrations = database.collection<{ _id: string; completedAt: Date }>('member_migrations');
    const key = 'unify-external-members-v1';
    if (await migrations.findOne({ _id: key })) return;

    await Promise.all([this.market.init(), this.registry.init()]);
    for (const [collection, group] of sources) {
      for await (const row of database.collection(collection).find().sort({ _id: 1 })) {
        const phone = normalizePhone(typeof row.phone === 'string' ? row.phone : '');
        if (!mobileNumberPattern.test(phone) || !(memberTypes[group] as readonly string[]).includes(row.type)) {
          throw new Error(`Invalid legacy member in ${collection}: ${row._id}`);
        }
        if (await this.users.exists({ phone })) throw new Error(`Legacy member conflicts with a panel account: ${row._id}`);

        const initial = Object.fromEntries(commonFields.filter(field => row[field] !== undefined).map(field => [field, row[field]]));
        await this.market.updateOne({ phone }, { $setOnInsert: { ...initial, _id: row._id, phone } },
          { upsert: true, timestamps: false });
        const member = await this.market.findOne({ phone }).orFail();
        if (group === MemberGroup.Customers) member.customerType = row.type;
        if (group === MemberGroup.Producers) {
          member.producerType = row.type;
          member.productionActivity = row.productionActivity;
          member.sellerReview ??= { status: 'pending' };
        }
        if (group === MemberGroup.Services) {
          if (!member.serviceTypes.includes(row.type)) member.serviceTypes.push(row.type);
          member.serviceArea = row.serviceArea;
          if (row.type === 'driver') member.driverReview ??= { status: 'pending' };
          if (needsSpecialistReview(member.serviceTypes)) member.specialistReview ??= { status: 'pending' };
        }
        await member.save();
        await this.registry.updateOne(
          { _id: phone, group: { $ne: MemberGroup.Users } },
          { $set: { group: 'marketplace', memberId: (member._id as Types.ObjectId).toString() } },
          { upsert: true },
        );
      }
    }
    await migrations.updateOne({ _id: key }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
  }
}
