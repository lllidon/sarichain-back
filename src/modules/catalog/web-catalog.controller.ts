import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { QueryFilter, isObjectIdOrHexString, Model } from 'mongoose';
import { Brand } from '../brands/schemas/brand.schema';
import { Category } from '../categories/schemas/category.schema';
import { Product } from '../products/schemas/product.schema';
import { CatalogQueryDto } from './catalog-query.dto';

const fields = 'name slug imageUrl thumbnailUrl shortDescription description';
const productFields = fields + ' sku kind categoryId brandId masterId basePrice price saleUnit saleUnits gallery priceAdjustment options physical';

@ApiTags('web')
@Controller('web')
export class WebCatalogController {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
  ) {}

  @Get('products')
  async listProducts(@Query() query: CatalogQueryDto) {
    const page = await this.list(this.products, query, productFields, ['name', 'slug', 'sku'], { kind: 'master' });
    return { ...page, items: await this.withVariants(page.items) };
  }

  @Get('products/:id')
  async product(@Param('id') id: string) {
    if (!isObjectIdOrHexString(id)) throw new NotFoundException();
    const product = await this.products.findOne({ _id: id, kind: 'master', isActive: true }).select(productFields).lean();
    if (!product) throw new NotFoundException();
    const [view] = await this.withVariants([product]);
    return view;
  }

  @Get('categories')
  listCategories(@Query() query: CatalogQueryDto) {
    return this.list(this.categories, query, fields + ' parentId level');
  }

  @Get('brands')
  listBrands(@Query() query: CatalogQueryDto) {
    return this.list(this.brands, query, fields);
  }

  private async withVariants<T extends { _id: unknown }>(products: T[]) {
    if (!products.length) return [];
    const variants = await this.products.find({
      masterId: { $in: products.map(product => String(product._id)) }, kind: 'variant', isActive: true,
    }).select(productFields).sort({ _id: 1 }).lean();
    const grouped = new Map<string, typeof variants>();
    for (const variant of variants) {
      const key = String(variant.masterId);
      const group = grouped.get(key) ?? [];
      group.push(variant);
      grouped.set(key, group);
    }
    return products.map(product => ({ ...product, variants: grouped.get(String(product._id)) ?? [] }));
  }

  private async list<T>(model: Model<T>, { page, limit, search }: CatalogQueryDto, projection: string, searchable = ['name', 'slug'], extra: QueryFilter<T> = {}) {
    const escaped = search?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      ...extra,
      isActive: true,
      ...(escaped && { $or: searchable.map(field => ({ [field]: new RegExp(escaped, 'iu') })) }),
    };
    const [items, total] = await Promise.all([
      model.find(filter).select(projection).sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      model.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
}
