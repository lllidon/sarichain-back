import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongoError, Model, Types } from 'mongoose';
import { hashPassword } from '../auth/password';
import { normalizePhone } from '../auth/phone';
import { User } from '../auth/schemas/user.schema';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { MemberDto } from './member.dto';
import { Customer, MemberPhone, Producer, ServiceProvider } from './member.schemas';
import { MemberGroup, memberTypes } from './member-types';

type MemberRecord = User | Customer | Producer | ServiceProvider;
const duplicate = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

@Injectable()
export class MembersService {
  private readonly models: Record<MemberGroup, Model<MemberRecord>>;

  constructor(
    @InjectModel(User.name) users: Model<User>,
    @InjectModel(Customer.name) customers: Model<Customer>,
    @InjectModel(Producer.name) producers: Model<Producer>,
    @InjectModel(ServiceProvider.name) providers: Model<ServiceProvider>,
    @InjectModel(MemberPhone.name) private readonly phones: Model<MemberPhone>,
  ) {
    this.models = {
      [MemberGroup.Users]: users as Model<MemberRecord>,
      [MemberGroup.Customers]: customers as Model<MemberRecord>,
      [MemberGroup.Producers]: producers as Model<MemberRecord>,
      [MemberGroup.Services]: providers as Model<MemberRecord>,
    };
  }

  async list(group: MemberGroup, { search, limit, page }: CatalogQueryDto) {
    const model = this.models[group];
    const query = search?.trim();
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = query ? { $or: [
      { fullName: new RegExp(escape(query), 'iu') },
      { organization: new RegExp(escape(query), 'iu') },
      { phone: new RegExp(escape(normalizePhone(query).replace(/^0(?=9)/, '+98'))) },
      ...(group === MemberGroup.Users ? [{ username: new RegExp(escape(query), 'iu') }] : []),
    ] } : {};
    const [items, total] = await Promise.all([
      model.find(filter).select('-passwordHash').sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      model.countDocuments(filter),
    ]);
    return { items, total, limit, page };
  }

  private async reserve(phone: string, group: MemberGroup, memberId: Types.ObjectId) {
    const owner = memberId.toString();
    try {
      await this.phones.create({ _id: phone, group, memberId: owner });
    } catch (error) {
      if (duplicate(error)) throw new ConflictException('این شماره موبایل قبلاً برای یکی از اعضا ثبت شده است.');
      throw error;
    }

    // Existing phone users may predate the shared phone registry.
    try {
      const existing = await Promise.all(Object.values(this.models).map(model => model.exists({ phone, _id: { $ne: memberId } })));
      if (existing.some(Boolean)) throw new ConflictException('این شماره موبایل قبلاً برای یکی از اعضا ثبت شده است.');
    } catch (error) {
      await this.phones.deleteOne({ _id: phone, group, memberId: owner });
      throw error;
    }
  }

  async save(group: MemberGroup, input: MemberDto, id?: string, actor?: string, legacy = false) {
    const { password, ...profile } = input;
    const model = this.models[group];
    const existing = id ? await model.findById(id).exec() : null;
    if (id && !existing) throw new NotFoundException('عضو پیدا نشد.');
    for (const value of Object.values(input)) {
      if (value === null) throw new BadRequestException('مقدار خالی نامعتبر است.');
    }
    if (profile.type !== undefined && !(memberTypes[group] as readonly string[]).includes(profile.type)) {
      throw new BadRequestException('نوع عضو برای این گروه معتبر نیست.');
    }
    if ((password !== undefined && group !== MemberGroup.Users) ||
        (profile.productionActivity !== undefined && group !== MemberGroup.Producers) ||
        (profile.serviceArea !== undefined && group !== MemberGroup.Services)) throw new BadRequestException('این فیلد برای گروه انتخاب‌شده معتبر نیست.');
    if (actor && id === actor && profile.isActive === false) throw new ConflictException('غیرفعال کردن حساب فعلی مجاز نیست.');

    const phone = profile.phone ?? existing?.phone;
    if (!phone || (!legacy && (!(profile.fullName ?? existing?.fullName)?.trim() || !(profile.type ?? existing?.type)))) {
      throw new BadRequestException('نام، شماره موبایل و نوع عضو الزامی‌اند.');
    }
    if (group === MemberGroup.Users && !id && !password) throw new BadRequestException('رمز عبور کاربر الزامی است.');

    const data = Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined));
    if (password) data.passwordHash = await hashPassword(password);
    const memberId = existing?._id ?? new Types.ObjectId();
    const changedPhone = phone !== existing?.phone;
    if (changedPhone) await this.reserve(phone, group, memberId);
    try {
      if (existing) {
        const match = changedPhone ? { _id: memberId, phone: existing.phone ?? { $exists: false } } : { _id: memberId };
        const updated = await model.findOneAndUpdate(match, { $set: data }, {
          returnDocument: 'after', runValidators: true,
        }).select('-passwordHash').lean();
        if (!updated) throw new ConflictException('رکورد تغییر کرده است. دوباره فهرست را باز کنید.');
        if (changedPhone && existing.phone) {
          await this.phones.deleteOne({ _id: existing.phone, group, memberId: memberId.toString() });
        }
        return updated;
      }
      await model.create({ ...data, _id: memberId });
      return await model.findById(memberId).select('-passwordHash').lean();
    } catch (error) {
      if (changedPhone && !await model.exists({ _id: memberId, phone })) {
        await this.phones.deleteOne({ _id: phone, group, memberId: memberId.toString() });
      }
      if (duplicate(error)) throw new ConflictException('این شماره موبایل قبلاً ثبت شده است.');
      if (error instanceof MongoError.ValidationError) throw new BadRequestException('مقادیر عضو معتبر نیستند.');
      throw error;
    }
  }
}
