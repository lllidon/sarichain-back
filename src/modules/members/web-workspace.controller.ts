import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param, ParseEnumPipe, Post, Query } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Connection, Types, isObjectIdOrHexString } from 'mongoose';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
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

class ProductOfferDto {
  @IsMongoId() productId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1_000_000) price!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1_000_000_000) stock!: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) harvestDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/workspace')
export class WebWorkspaceController {
  constructor(private readonly accounts: MarketplaceAccounts, @InjectConnection() private readonly connection: Connection) {}

  private get entries() {
    return this.connection.db!.collection('web_workspace_entries');
  }

  @Get(':section')
  async list(@Headers('authorization') authorization: string | undefined,
    @Param('section', new ParseEnumPipe(Section)) section: Section, @Query() { page, limit }: CatalogQueryDto) {
    const member = await this.accounts.requireMember(authorization);
    const filter = section === Section.Bulletin ? { section } : { section, memberId: member._id };
    const [items, total] = await Promise.all([
      this.entries.find(filter, { projection: { section: 0 } }).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).toArray(),
      this.entries.countDocuments(filter),
    ]);
    return {
      items: items.map(({ _id, memberId, title, details, offer, createdAt }) =>
        ({ id: _id, title, details, offer, createdAt, owned: member._id.equals(memberId) })),
      total, page, limit,
    };
  }

  @Post('products/offers')
  async createOffer(@Headers('authorization') authorization: string | undefined, @Body() input: ProductOfferDto) {
    const member = await this.accounts.requireMember(authorization);
    if (!member.producerType) throw new ForbiddenException();
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
