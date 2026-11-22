import { BadRequestException, Body, ConflictException, Controller, Get, Header, NotFoundException, Param, ParseEnumPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { isObjectIdOrHexString, Model } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AllowClient, type AccessRequest } from '../auth/access';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { Branch, BranchOrder, Profile } from './organization.schemas';

enum SettingsList {
  Branches = 'branches',
  Profiles = 'profiles',
}

class SettingsInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(140) name?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/i) code?: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
}

@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('organization')
export class OrganizationController {
  constructor(
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(BranchOrder.name) private readonly orders: Model<BranchOrder>,
  ) {}

  @Get('orders')
  @AllowClient()
  @Header('Cache-Control', 'private, no-store')
  async listOrders(@Req() { access }: AccessRequest, @Query() { page, limit }: CatalogQueryDto) {
    if (access.role !== 'management' && !access.branchId) return { items: [], total: 0, page, limit };
    const filter = access.role === 'management' ? {} : { branchId: access.branchId };
    const [items, total] = await Promise.all([
      this.orders.find(filter).select('number status branchId createdAt').populate('branchId', 'name')
        .sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.orders.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  @Get(':list')
  @Header('Cache-Control', 'private, no-store')
  async list(@Param('list', new ParseEnumPipe(SettingsList)) list: SettingsList, @Req() { access }: AccessRequest) {
    if (list === SettingsList.Profiles) return this.profiles.find().sort({ name: 1 }).lean();
    return this.branches.find(access.role === 'management' ? {} : { _id: access.branchId ?? null }).sort({ name: 1 }).lean();
  }

  @Post(':list')
  @UseGuards(AdminGuard)
  create(@Param('list', new ParseEnumPipe(SettingsList)) list: SettingsList, @Body() input: SettingsInput) {
    return this.save(list, input);
  }

  @Patch(':list/:id')
  @UseGuards(AdminGuard)
  update(@Param('list', new ParseEnumPipe(SettingsList)) list: SettingsList, @Param('id') id: string, @Body() input: SettingsInput) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه معتبر نیست.');
    return this.save(list, input, id);
  }

  private async save(list: SettingsList, input: SettingsInput, id?: string) {
    const model = (list === SettingsList.Branches ? this.branches : this.profiles) as Model<Branch | Profile>;
    if ((!id && (!input.name?.trim() || !input.code)) || input.name?.trim() === '' ||
        Object.values(input).some(value => value === null) || (list === SettingsList.Profiles && input.city !== undefined)) {
      throw new BadRequestException('نام، کد یا فیلدهای رکورد معتبر نیستند.');
    }
    try {
      await model.init();
      const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const result = id ? await model.findByIdAndUpdate(id, { $set: fields }, { returnDocument: 'after', runValidators: true })
        : await model.create(fields);
      if (!result) throw new NotFoundException('رکورد پیدا نشد.');
      return result;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException('این کد قبلاً ثبت شده است.');
      }
      throw error;
    }
  }
}
