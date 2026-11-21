import { Controller, Get, Header, Param, ParseEnumPipe, Query, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Brand } from '../brands/schemas/brand.schema';
import { Category } from '../categories/schemas/category.schema';
import { Product } from '../products/schemas/product.schema';
import { CatalogQueryDto } from './catalog-query.dto';

enum CatalogCollection {
  Products = 'products',
  Categories = 'categories',
  Brands = 'brands',
}

const commonFields = 'name slug imageUrl thumbnailUrl shortDescription isActive updatedAt';

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
  ) {}

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
        return this.find(this.products, query, commonFields + ' sku itemId kind categoryId brandId masterId basePrice priceAdjustment',
          ['name', 'slug', 'sku', 'itemId'], ['categoryId', 'brandId', 'masterId']);
      case CatalogCollection.Categories:
        return this.find(this.categories, query, commonFields + ' parentId level', ['name', 'slug'], ['parentId']);
      case CatalogCollection.Brands:
        return this.find(this.brands, query, commonFields, ['name', 'slug'], []);
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
