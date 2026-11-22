import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongoError, Model, Types } from 'mongoose';
import type { AccessContext } from '../auth/access';
import { LocationsService } from '../locations/locations.service';
import { Branch, Profile } from '../organization/organization.schemas';
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
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    private readonly locations: LocationsService,
  ) {
    this.models = {
      [MemberGroup.Users]: users as Model<MemberRecord>,
      [MemberGroup.Customers]: customers as Model<MemberRecord>,
      [MemberGroup.Producers]: producers as Model<MemberRecord>,
      [MemberGroup.Services]: providers as Model<MemberRecord>,
    };
  }

  async list(group: MemberGroup, { search, limit, page }: CatalogQueryDto, access: AccessContext) {
    const model = this.models[group];
    const query = search?.trim();
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchByName = { fullName: new RegExp(escape(query ?? ''), 'iu') };
    const searchFilter = query ? { $or: [
      searchByName,
      { organization: new RegExp(escape(query), 'iu') },
      { phone: new RegExp(escape(normalizePhone(query).replace(/^0(?=9)/, '+98'))) },
      ...(group === MemberGroup.Users ? [{ username: new RegExp(escape(query), 'iu') }] : []),
    ] } : {};
    if (access.role === 'admin' && !access.branchId) throw new ForbiddenException('شعبه حساب مشخص نیست.');
    const scope = access.role === 'management' ? {} : group === MemberGroup.Users
      ? { $or: [{ role: 'admin', branchId: { $ne: access.branchId } }, { role: 'client', branchId: access.branchId }] }
      : { branchId: access.branchId };
    const visibleSearch = access.role === 'admin' && group === MemberGroup.Users && query
      ? { $or: [searchByName, { $and: [{ branchId: access.branchId }, searchFilter] }] } : searchFilter;
    const filter = { $and: [scope, visibleSearch] };
    const sort = group === MemberGroup.Users ? 'branchId role _id' : '_id';
    const queryItems = model.find(filter).select('-passwordHash').sort(sort).skip((page - 1) * limit).limit(limit).populate('branchId', 'name');
    if (group === MemberGroup.Users) queryItems.populate('profileId', 'name');
    const [items, total] = await Promise.all([
      queryItems.lean(),
      model.countDocuments(filter),
    ]);
    return { items: items.map(item => {
      if (access.role !== 'admin' || group !== MemberGroup.Users || !('role' in item) || item.role !== 'admin') return item;
      return { _id: item._id, fullName: item.fullName, role: item.role, branchId: item.branchId };
    }), total, limit, page };
  }

  async seedOrganization(password: string) {
    const branches = [
      { code: 'sari', name: 'شعبه ساری', city: 'ساری' },
      { code: 'babol', name: 'شعبه بابل', city: 'بابل' },
      { code: 'amol', name: 'شعبه آمل', city: 'آمل' },
      { code: 'qaemshahr', name: 'شعبه قائم‌شهر', city: 'قائم‌شهر' },
      { code: 'behshahr', name: 'شعبه بهشهر', city: 'بهشهر' },
    ];
    const profiles = [
      { code: 'accounting', name: 'حسابداری' },
      { code: 'sales', name: 'فروش' },
      { code: 'marketing', name: 'بازاریابی' },
      { code: 'operations', name: 'عملیات' },
    ];
    const database = this.branches.db.db;
    if (!database) throw new Error('MongoDB is not connected.');
    const seeds = database.collection<{ _id: string }>('catalog_seed_runs');
    const seedId = 'organization-access-v1';
    if (await seeds.findOne({ _id: seedId })) return;
    await Promise.all([this.branches.init(), this.profiles.init()]);
    const profileRows = [];
    for (const row of profiles) {
      profileRows.push(await this.profiles.findOneAndUpdate({ code: row.code }, { $setOnInsert: row },
        { upsert: true, returnDocument: 'after' }).orFail());
    }
    for (const [index, row] of branches.entries()) {
      const branch = await this.branches.findOneAndUpdate({ code: row.code }, { $setOnInsert: row },
        { upsert: true, returnDocument: 'after' }).orFail();
      for (const [offset, role] of (['admin', 'client'] as const).entries()) {
        const phone = '+989129000' + String(101 + index * 2 + offset);
        const existing = await this.models[MemberGroup.Users].findOne({ phone }).select('role branchId').lean();
        if (existing) {
          if (!('role' in existing) || existing.role !== role || !existing.branchId?.equals(branch._id)) {
            throw new ConflictException('شماره یکی از حساب‌های آزمایشی در استفاده است.');
          }
          continue;
        }
        await this.save(MemberGroup.Users, {
          fullName: `${role === 'admin' ? 'ادمین' : 'کلاینت'} آزمایشی ${row.city}`,
          phone, role, branchId: branch.id, profileId: profileRows[(index + offset) % profileRows.length].id,
          type: role === 'admin' ? 'operations' : 'sales', password,
        });
      }
    }
    await seeds.updateOne({ _id: seedId }, { $setOnInsert: { _id: seedId } }, { upsert: true });
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

  async save(group: MemberGroup, input: MemberDto, id?: string, actor?: string, legacy = false, access?: AccessContext) {
    const { password, role, profileId, branchId: requestedBranch, ...profile } = input;
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

    const existingUser = group === MemberGroup.Users ? existing as User | null : null;
    const existingRole = existingUser ? existingUser.role ?? 'client' : undefined;
    let branchId = requestedBranch ?? existing?.branchId?.toString();
    const userProfile = profileId ?? existingUser?.profileId?.toString();
    let effectiveRole = existingRole ?? role;

    if (group !== MemberGroup.Users && (role !== undefined || profileId !== undefined)) {
      throw new BadRequestException('نقش و پروفایل مخصوص کاربران پنل است.');
    }
    if (existingRole && role && role !== existingRole) throw new BadRequestException('نقش حساب پس از ایجاد ثابت است.');
    if (access?.role === 'admin') {
      if (!access.branchId || (requestedBranch && requestedBranch !== access.branchId) ||
          (existing && existing.branchId?.toString() !== access.branchId) ||
          (group === MemberGroup.Users && (existingRole ?? role ?? 'client') !== 'client')) {
        throw new ForbiddenException('تغییر فقط در محدوده شعبه و نقش مجاز است.');
      }
      branchId = access.branchId;
      if (group === MemberGroup.Users) effectiveRole = 'client';
    }
    if (access?.role === 'management' && group === MemberGroup.Users && !existing) {
      if (role && role !== 'admin') throw new ForbiddenException('مدیریت فقط ادمین تعریف می‌کند.');
      effectiveRole = 'admin';
    }

    if (group === MemberGroup.Users && !legacy && effectiveRole !== 'management' && (!branchId || !userProfile)) {
      throw new BadRequestException('شعبه و پروفایل کاربر الزامی هستند.');
    }
    if (branchId && !await this.branches.exists({ _id: branchId })) throw new BadRequestException('شعبه معتبر نیست.');
    if (userProfile && !await this.profiles.exists({ _id: userProfile })) throw new BadRequestException('پروفایل معتبر نیست.');

    const phone = profile.phone ?? existing?.phone;
    if (!phone || (!legacy && (!(profile.fullName ?? existing?.fullName)?.trim() || !(profile.type ?? existing?.type)))) {
      throw new BadRequestException('نام، شماره موبایل و نوع عضو الزامی‌اند.');
    }
    if (group === MemberGroup.Users && !id && !password) throw new BadRequestException('رمز عبور کاربر الزامی است.');

    const data: Record<string, unknown> = Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined));
    Object.assign(data, await this.locations.memberPlacement(profile, existing));
    if (branchId) data.branchId = new Types.ObjectId(branchId);
    if (userProfile) data.profileId = new Types.ObjectId(userProfile);
    if (effectiveRole) data.role = effectiveRole;
    if (password) data.passwordHash = await hashPassword(password);
    const memberId = existing?._id ?? new Types.ObjectId();
    const changedPhone = phone !== existing?.phone;
    if (changedPhone) await this.reserve(phone, group, memberId);
    try {
      if (existing) {
        const match = {
          _id: memberId,
          ...(changedPhone && { phone: existing.phone ?? { $exists: false } }),
          ...(access?.role === 'admin' && { branchId: access.branchId }),
        };
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
