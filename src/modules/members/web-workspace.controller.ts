import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, Headers, HttpCode, NotFoundException, Param, ParseEnumPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Connection, Types, isObjectIdOrHexString, mongo } from 'mongoose';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { maxUploadImageBytes, prepareUploadedImage } from '../catalog/image-processing';
import { LocationsService } from '../locations/locations.service';
import { MarketplaceAccounts } from './marketplace-account.service';

enum Section {
  Products = 'products',
  Transport = 'transport',
  Bulletin = 'bulletin',
  Orchards = 'orchards',
  Advisory = 'advisory',
}

class WorkspaceEntryDto {
  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 120) title!: string;

  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 1000) details!: string;
}


const vehicleTypes = ['motorcycle', 'car', 'pickup', 'van', 'truckette', 'truck'] as const;

class VehicleProfileDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsIn(vehicleTypes) type!: (typeof vehicleTypes)[number];
  @IsOptional() @IsString() @MaxLength(40) className?: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(2, 100) model!: string;
  @IsInt() @Min(1300) @Max(1500) year!: number;
  @IsInt() @Min(1) @Max(100000) capacityKg!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10000) capacityM3?: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(3, 40) plate!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(3, 80) license!: string;
  @IsOptional() @IsString() @MaxLength(40) licenseClass?: string;
  @IsOptional() @IsString() @MaxLength(40) bodyType?: string;
  @IsOptional() @IsString() @Matches(/^(?:\d{4}\/\d{2}\/\d{2})?$/) insuranceExpiry?: string;
  @IsOptional() @IsString() @Matches(/^(?:\d{4}\/\d{2}\/\d{2})?$/) technicalInspectionExpiry?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

class ProductOfferDto {
  @IsMongoId() productId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1_000_000) price!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000_000) stock!: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) harvestDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsMongoId() locationId?: string;
}

const locationTypes = ['orchard', 'farmland', 'greenhouse', 'nursery', 'warehouse', 'other'] as const;

function coordinate({ value }: { value: unknown }) {
  return typeof value === 'string' && /^-?\d{1,3}(?:\.\d{1,6})?$/.test(value) ? Number(value) : NaN;
}

class LocationEntryDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 120) title!: string;
  @IsIn(locationTypes) type!: (typeof locationTypes)[number];
  @Matches(/^\d{1,10}$/) provinceCode!: string;
  @Matches(/^\d{1,10}$/) cityCode!: string;
  @Transform(coordinate) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Transform(coordinate) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsString() @MaxLength(1000) details?: string;
}

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/workspace')
export class WebWorkspaceController {
  constructor(private readonly accounts: MarketplaceAccounts, private readonly locations: LocationsService,
    @InjectConnection() private readonly connection: Connection) {}

  private get entries() {
    return this.connection.db!.collection('web_workspace_entries');
  }


  private get vehicles() {
    return this.connection.db!.collection('member_vehicles');
  }

  @Get('transport/vehicle')
  @Header('Cache-Control', 'private, no-store')
  async getVehicle(@Headers('authorization') authorization: string | undefined) {
    const member = await this.accounts.requireMember(authorization);
    const record = await this.vehicles.findOne({ memberId: member._id });
    if (!record) return { vehicle: null };
    const { _id, memberId, createdAt, updatedAt, ...vehicle } = record;
    return { vehicle };
  }

  @Patch('transport/vehicle')
  @Header('Cache-Control', 'private, no-store')
  async saveVehicle(@Headers('authorization') authorization: string | undefined, @Body() input: VehicleProfileDto) {
    const member = await this.accounts.requireMember(authorization);
    const now = new Date();
    await this.vehicles.createIndex({ memberId: 1 }, { unique: true, name: 'uniq_member_vehicle' });
    const previous = await this.vehicles.findOne({ memberId: member._id });
    const changed = !previous || !member.vehicle || ['type', 'model', 'year', 'capacityKg', 'capacityM3', 'plate', 'license', 'licenseClass', 'bodyType', 'insuranceExpiry', 'technicalInspectionExpiry']
      .some(key => (previous as Record<string, unknown>)[key] !== (input as unknown as Record<string, unknown>)[key]);
    await this.vehicles.updateOne(
      { memberId: member._id },
      { $set: { ...input, memberId: member._id, updatedAt: now }, $setOnInsert: { createdAt: now }, ...(input.capacityM3 === undefined ? { $unset: { capacityM3: '' } } : {}) },
      { upsert: true },
    );
    if (changed) await this.connection.db!.collection('members').updateOne(
      { _id: member._id },
      { $set: { vehicle: { type: input.type, plate: input.plate, license: input.license }, driverReview: { status: 'pending' }, updatedAt: now } },
    );
    const { _id, memberId, createdAt, updatedAt, ...vehicle } = (await this.vehicles.findOne({ memberId: member._id }))!;
    return { vehicle };
  }

  @Get(':section')
  async list(@Headers('authorization') authorization: string | undefined,
    @Param('section', new ParseEnumPipe(Section)) section: Section, @Query() { page, limit }: CatalogQueryDto) {
    const member = await this.accounts.requireMember(authorization);
    const filter = section === Section.Bulletin ? { section } : { section, memberId: member._id };
    const [items, total] = await Promise.all([
      this.entries.find(filter, { projection: { section: 0, photo: 0 } }).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).toArray(),
      this.entries.countDocuments(filter),
    ]);
    return {
      items: items.map(({ _id, memberId, title, details, location, photoType, offer, createdAt }) =>
        ({ id: _id, title, details, location, hasPhoto: photoType ? true : undefined, offer, createdAt, owned: member._id.equals(memberId) })),
      total, page, limit,
    };
  }

  @Get('orchards/options')
  async locationOptions(@Headers('authorization') authorization: string | undefined) {
    const member = await this.accounts.requireMember(authorization);
    const rows = await this.entries.find({ section: Section.Orchards, memberId: member._id }, {
      projection: { title: 1, 'location.city': 1 },
    }).sort({ title: 1, _id: 1 }).toArray();
    return rows.map(row => ({ id: row._id, title: row.title, city: row.location?.city }));
  }

  @Post('orchards/locations')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: maxUploadImageBytes, files: 1, fields: 7, fieldSize: 4096 } }))
  async createLocation(@Headers('authorization') authorization: string | undefined, @Body() input: LocationEntryDto,
    @UploadedFile() file?: { buffer: Buffer }) {
    const member = await this.accounts.requireMember(authorization);
    const placement = await this.locations.memberPlacement({ provinceCode: input.provinceCode, cityCode: input.cityCode });
    const image = file ? await prepareUploadedImage(file.buffer) : null;
    const { insertedId } = await this.entries.insertOne({
      section: Section.Orchards, memberId: member._id, title: input.title, details: input.details?.trim() ?? '',
      location: { ...placement, type: input.type, latitude: input.latitude, longitude: input.longitude },
      ...(image && { photo: new mongo.Binary(image.data), photoType: image.type }),
      createdAt: new Date(),
    });
    return { id: insertedId };
  }

  @Get('orchards/:id/image')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async locationImage(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    const member = await this.accounts.requireMember(authorization);
    if (!isObjectIdOrHexString(id)) throw new NotFoundException();
    const entry = await this.entries.findOne({ _id: new Types.ObjectId(id), section: Section.Orchards, memberId: member._id },
      { projection: { photo: 1, photoType: 1 } });
    if (!entry?.photo || !entry.photoType) throw new NotFoundException();
    return new StreamableFile(entry.photo.value(), { type: entry.photoType });
  }

  @Post('products/offers')
  async createOffer(@Headers('authorization') authorization: string | undefined, @Body() input: ProductOfferDto) {
    const member = await this.accounts.requireMember(authorization);
    if (!member.producerType) throw new ForbiddenException();
    const location = input.locationId ? await this.entries.findOne({
      _id: new Types.ObjectId(input.locationId), section: Section.Orchards, memberId: member._id,
    }, { projection: { title: 1 } }) : null;
    if (input.locationId && !location) throw new BadRequestException('موقعیت انتخاب‌شده معتبر نیست.');
    const products = this.connection.db!.collection('products');
    const fields = { name: 1, kind: 1, masterId: 1, saleUnit: 1, sku: 1, description: 1 };
    const productId = new Types.ObjectId(input.productId);
    const product = await products.findOne({ _id: productId, isActive: true, kind: { $in: ['master', 'variant'] } },
      { projection: fields });
    if (!product) throw new BadRequestException('این محصول قابل انتخاب نیست.');
    const parent = product.kind === 'variant'
      ? await products.findOne({ _id: product.masterId, kind: 'master', isActive: true }, { projection: fields })
      : null;
    if (product.kind === 'variant' && !parent) throw new BadRequestException('محصول اصلی فعال نیست.');
    const unit = product.saleUnit || parent?.saleUnit
      || (parent ?? product).description?.match(/هر (لیتر|کیلوگرم)/)?.[1] || 'واحد';
    const { insertedId } = await this.entries.insertOne({
      section: Section.Products, memberId: member._id, title: product.name, details: input.notes?.trim() ?? '',
      offer: {
        productId, sku: product.sku, unit, price: input.price, stock: input.stock,
        ...(input.harvestDate && { harvestDate: input.harvestDate }),
        ...(location && { locationId: location._id, locationTitle: location.title }),
      },
      createdAt: new Date(),
    });
    return { id: insertedId };
  }

  @Post(':section')
  async create(@Headers('authorization') authorization: string | undefined,
    @Param('section', new ParseEnumPipe(Section)) section: Section, @Body() input: WorkspaceEntryDto) {
    const member = await this.accounts.requireMember(authorization);
    const { insertedId } = await this.entries.insertOne({
      section, memberId: member._id, title: input.title, details: input.details, createdAt: new Date(),
    });
    return { id: insertedId };
  }

  @Delete(':section/:id')
  @HttpCode(204)
  async remove(@Headers('authorization') authorization: string | undefined,
    @Param('section', new ParseEnumPipe(Section)) section: Section, @Param('id') id: string) {
    const member = await this.accounts.requireMember(authorization);
    if (!isObjectIdOrHexString(id)) throw new NotFoundException();
    const result = await this.entries.deleteOne({ _id: new Types.ObjectId(id), section, memberId: member._id });
    if (!result.deletedCount) throw new NotFoundException();
  }
}
