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
import { MarketplaceMember, MemberPhone } from './member.schemas';
import { MemberGroup, memberTypes, needsSpecialistReview } from './member-types';

type MemberRecord = User | MarketplaceMember;
const externalRoleFilter = {
  [MemberGroup.Customers]: { customerType: { $exists: true } },
  [MemberGroup.Producers]: { producerType: { $exists: true, $ne: '' } },
  [MemberGroup.Services]: { 'serviceTypes.0': { $exists: true } },
};
const duplicate = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

@Injectable()
export class MembersService {
  private readonly models: Record<MemberGroup, Model<MemberRecord>>;

  constructor(
    @InjectModel(User.name) users: Model<User>,
    @InjectModel(MarketplaceMember.name) private readonly marketplace: Model<MarketplaceMember>,
    @InjectModel(MemberPhone.name) private readonly phones: Model<MemberPhone>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    private readonly locations: LocationsService,
  ) {
    this.models = {
      [MemberGroup.Users]: users as Model<MemberRecord>,
      [MemberGroup.Customers]: marketplace as Model<MemberRecord>,
      [MemberGroup.Producers]: marketplace as Model<MemberRecord>,
      [MemberGroup.Services]: marketplace as Model<MemberRecord>,
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
    const filter = { $and: [scope, visibleSearch, group === MemberGroup.Users ? {} : externalRoleFilter[group]] };
    const sort = group === MemberGroup.Users ? 'branchId role _id' : '_id';
    const queryItems = model.find(filter).select('-passwordHash').sort(sort).skip((page - 1) * limit).limit(limit).populate('branchId', 'name');
    if (group === MemberGroup.Users) queryItems.populate('profileId', 'name');
    const [items, total] = await Promise.all([
      queryItems.lean(),
      model.countDocuments(filter),
    ]);
    return { items: items.map(item => {
      if (group !== MemberGroup.Users) {
        const member = item as unknown as MarketplaceMember;
        const type = group === MemberGroup.Customers ? member.customerType
          : group === MemberGroup.Producers ? member.producerType : member.serviceTypes[0];
        return { ...item, type };
      }
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

  private async reserve(phone: string, group: MemberGroup | 'marketplace', memberId: Types.ObjectId) {
    const owner = memberId.toString();
    try {
      await this.phones.create({ _id: phone, group, memberId: owner });
    } catch (error) {
      if (duplicate(error)) throw new ConflictException('این شماره موبایل قبلاً برای یکی از اعضا ثبت شده است.');
      throw error;
    }

    // Existing phone users may predate the shared phone registry.
    try {
      const existing = await Promise.all([this.models[MemberGroup.Users], this.marketplace as Model<MemberRecord>].map(model => model.exists({ phone, _id: { $ne: memberId } })));
      if (existing.some(Boolean)) throw new ConflictException('این شماره موبایل قبلاً برای یکی از اعضا ثبت شده است.');
    } catch (error) {
      await this.phones.deleteOne({ _id: phone, group, memberId: owner });
      throw error;
    }
  }

  async save(group: MemberGroup, input: MemberDto, id?: string, actor?: string, legacy = false, access?: AccessContext) {
    const { password, role, profileId, reviewTarget, reviewDecision, branchId: requestedBranch, ...profile } = input;
    const external = group !== MemberGroup.Users;
    const registryGroup = external ? 'marketplace' : group;
    const model = this.models[group];
    const existing = id ? await model.findById(id).exec()
      : external && profile.phone ? await model.findOne({ phone: profile.phone }).exec() : null;
    const existingMember = external ? existing as MarketplaceMember | null : null;
    if (id && !existing) throw new NotFoundException('عضو پیدا نشد.');
    for (const value of Object.values(input)) {
      if (value === null) throw new BadRequestException('مقدار خالی نامعتبر است.');
    }
    if (profile.type !== undefined && !(memberTypes[group] as readonly string[]).includes(profile.type)) {
      throw new BadRequestException('نوع عضو برای این گروه معتبر نیست.');
    }
    if ((profile.productionActivity !== undefined && group !== MemberGroup.Producers) ||
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

    const savedType = existingMember
      ? group === MemberGroup.Customers ? existingMember.customerType
        : group === MemberGroup.Producers ? existingMember.producerType : existingMember.serviceTypes[0]
      : existing && 'type' in existing ? existing.type : undefined;
    const phone = profile.phone ?? existing?.phone;
    if (!phone || (!legacy && (!(profile.fullName ?? existing?.fullName)?.trim() || !(profile.type ?? savedType)))) {
      throw new BadRequestException('نام، شماره موبایل و نوع عضو الزامی‌اند.');
    }
    if (group === MemberGroup.Users && !id && !password) throw new BadRequestException('رمز عبور کاربر الزامی است.');

    const data: Record<string, unknown> = Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined));
    Object.assign(data, await this.locations.memberPlacement(profile, existing));
    if (branchId) data.branchId = new Types.ObjectId(branchId);
    if (userProfile) data.profileId = new Types.ObjectId(userProfile);
    if (effectiveRole) data.role = effectiveRole;
    if (external) {
      if (!id && existingMember) {
        for (const field of ['fullName', 'email', 'organization', 'province', 'city', 'provinceCode', 'cityCode', 'address', 'notes', 'isActive', 'branchId']) delete data[field];
      }
      delete data.type;
      const type = profile.type ?? savedType;
      if (group === MemberGroup.Customers) data.customerType = type;
      if (group === MemberGroup.Producers) {
        if (!id && existingMember?.producerType) throw new ConflictException('این عضو در فهرست تولیدکنندگان وجود دارد.');
        data.producerType = type;
        if (!existingMember?.sellerReview || type !== existingMember.producerType ||
            (profile.productionActivity !== undefined && profile.productionActivity !== existingMember.productionActivity)) {
          data.sellerReview = { status: 'pending' };
        }
      }
      if (group === MemberGroup.Services && type) {
        const previous = existingMember?.serviceTypes ?? [];
        if (!id && previous.includes(type)) throw new ConflictException('این خدمت قبلاً برای عضو ثبت شده است.');
        data.serviceTypes = id ? [type, ...previous.slice(1).filter(value => value !== type)] : [...previous, type];
        if (type === 'driver' && !existingMember?.driverReview) data.driverReview = { status: 'pending' };
        if (needsSpecialistReview(data.serviceTypes as string[]) && !existingMember?.specialistReview) data.specialistReview = { status: 'pending' };
      }
      if (reviewTarget || reviewDecision) {
        if (access?.role !== 'management') throw new ForbiddenException('بررسی مجوز فقط در اختیار مدیریت است.');
        if (!existingMember || !id || !reviewTarget || !reviewDecision) throw new BadRequestException('درخواست بررسی معتبر نیست.');
        const services = (data.serviceTypes as string[] | undefined) ?? existingMember.serviceTypes;
        const ready = reviewTarget === 'sellerReview' ? group === MemberGroup.Producers && Boolean(data.producerType ?? existingMember.producerType)
          : group === MemberGroup.Services && (reviewTarget === 'driverReview' ? services.includes('driver') : needsSpecialistReview(services));
        if (!ready) throw new BadRequestException('نقش مربوط به درخواست ثبت نشده است.');
        if (reviewDecision === 'approved' && ((reviewTarget === 'driverReview' && !existingMember.vehicle) ||
            (reviewTarget === 'specialistReview' && !existingMember.serviceCredential))) throw new BadRequestException('مدارک این نقش هنوز ثبت نشده‌اند.');
        data[reviewTarget] = { status: reviewDecision, reviewedAt: new Date(), reviewedBy: actor };
      }
      if (!id && existingMember && password) throw new BadRequestException('برای تعیین رمز عضو موجود، از ویرایش استفاده کنید.');
    } else if (reviewTarget || reviewDecision) {
      throw new BadRequestException('درخواست بررسی مخصوص اعضای بازار است.');
    }
    if (password) data.passwordHash = await hashPassword(password);
    const memberId = existing?._id ?? new Types.ObjectId();
    const changedPhone = phone !== existing?.phone;
    if (changedPhone) await this.reserve(phone, registryGroup, memberId);
    try {
      if (existing) {
        const match = {
          _id: memberId,
          ...(changedPhone && { phone: existing.phone ?? { $exists: false } }),
          ...(access?.role === 'admin' && { branchId: access.branchId }),
          ...(external && { __v: existing.__v ?? 0 }),
        };
        const updated = await model.findOneAndUpdate(match, { $set: data, ...(external && { $inc: { __v: 1 } }) }, {
          returnDocument: 'after', runValidators: true,
        }).select('-passwordHash').lean();
        if (!updated) throw new ConflictException('رکورد تغییر کرده است. دوباره فهرست را باز کنید.');
        if (changedPhone && existing.phone) {
          await this.phones.deleteOne({ _id: existing.phone, group: registryGroup, memberId: memberId.toString() });
        }
        return updated;
      }
      await model.create({ ...data, _id: memberId });
      return await model.findById(memberId).select('-passwordHash').lean();
    } catch (error) {
      if (changedPhone && !await model.exists({ _id: memberId, phone })) {
        await this.phones.deleteOne({ _id: phone, group: registryGroup, memberId: memberId.toString() });
      }
      if (duplicate(error)) throw new ConflictException('این شماره موبایل قبلاً ثبت شده است.');
      if (error instanceof MongoError.ValidationError) throw new BadRequestException('مقادیر عضو معتبر نیستند.');
      throw error;
    }
  }
}
