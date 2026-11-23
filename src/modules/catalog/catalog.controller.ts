import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseEnumPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { isObjectIdOrHexString, Model } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Brand } from '../brands/schemas/brand.schema';
import { Category } from '../categories/schemas/category.schema';
import { Product } from '../products/schemas/product.schema';
import { CatalogQueryDto } from './catalog-query.dto';

import { CatalogCollection } from './catalog-collection';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogWriteDto, TagWriteDto } from './catalog-write.dto';
import { CatalogWriteService } from './catalog-write.service';
import { normalizeTagName, Tag } from './tag.schema';

const commonFields = 'name slug imageUrl thumbnailUrl shortDescription description isActive updatedAt tagIds';

@ApiTags('catalog')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'توکن دسترسی معتبر لازم است.' })
@UseGuards(AccessTokenGuard)
@Controller('catalog')
export class CatalogController {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @InjectModel(Tag.name) private readonly tags: Model<Tag>,
    private readonly writes: CatalogWriteService,
  ) {}

  @Get('tags')
  listTags(@Query() query: CatalogQueryDto) {
    return this.find(this.tags, { ...query, search: query.search && normalizeTagName(query.search) }, 'name', ['key', 'name'], []);
  }

  @Post('tags')
  @UseGuards(AdminGuard)
  createTag(@Body() input: TagWriteDto) {
    return this.writes.createTag(input.name);
  }

  @Post(':collection')
  @UseGuards(AdminGuard)
  create(@Param('collection', new ParseEnumPipe(CatalogCollection)) collection: CatalogCollection, @Body() input: CatalogWriteDto) {
    return this.writes.save(collection, input);
  }

  @Patch(':collection/:id')
  @UseGuards(AdminGuard)
  update(@Param('collection', new ParseEnumPipe(CatalogCollection)) collection: CatalogCollection,
    @Param('id') id: string, @Body() input: CatalogWriteDto) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه رکورد معتبر نیست.');
    return this.writes.save(collection, input, id);
  }

  @Delete(':collection/:id')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  remove(@Param('collection', new ParseEnumPipe(CatalogCollection)) collection: CatalogCollection, @Param('id') id: string) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه رکورد معتبر نیست.');
    return this.writes.delete(collection, id);
  }

  @Get(':collection')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'collection', enum: CatalogCollection })
  @ApiOkResponse({ description: 'فهرست صفحه‌بندی‌شده شامل items، total، page و limit' })
  list(
    @Param('collection', new ParseEnumPipe(CatalogCollection)) collection: CatalogCollection,
    @Query() query: CatalogQueryDto,
  ) {
    switch (collection) {
      case CatalogCollection.Products:
        return this.find(this.products, query, commonFields + ' sku itemId kind categoryId brandId masterId basePrice price saleUnit saleUnits gallery priceAdjustment physical options',
          ['name', 'slug', 'sku', 'itemId'], ['categoryId', 'brandId', 'masterId', 'tagIds']);
      case CatalogCollection.Categories:
        return this.find(this.categories, query, commonFields + ' parentId level', ['name', 'slug'], ['parentId', 'tagIds']);
      case CatalogCollection.Brands:
        return this.find(this.brands, query, commonFields, ['name', 'slug'], ['tagIds']);
    }
  }

  private async find<T>(model: Model<T>, query: CatalogQueryDto, fields: string, searchable: string[], references: string[]) {
    const search = query.search?.trim();
    const literal = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu') : null;
    const filter = literal ? { $or: searchable.map(field => ({ [field]: literal })) } : {};
    const [items, total] = await Promise.all([
      model.find(filter).select(fields).sort({ _id: 1 })
        .skip((query.page - 1) * query.limit).limit(query.limit)
        .populate(references.map(path => ({ path, select: 'name' }))).lean().exec(),
      model.countDocuments(filter).exec(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
}
