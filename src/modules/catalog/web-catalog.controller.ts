import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { isObjectIdOrHexString, Model } from 'mongoose';
import { Brand } from '../brands/schemas/brand.schema';
import { Category } from '../categories/schemas/category.schema';
import { Product } from '../products/schemas/product.schema';
import { CatalogQueryDto } from './catalog-query.dto';

const fields = 'name slug imageUrl thumbnailUrl shortDescription description';
const productFields = fields + ' sku kind categoryId brandId masterId basePrice price saleUnit saleUnits priceAdjustment options';

@ApiTags('web')
@Controller('web')
export class WebCatalogController {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
  ) {}

  @Get('products')
  listProducts(@Query() query: CatalogQueryDto) {
    return this.listProductsWithPrices(query);
  }

  private async listProductsWithPrices(query: CatalogQueryDto) {
    const page = await this.list(this.products, query, productFields, ['name', 'slug', 'sku']);
    return { ...page, items: await this.withPrices(page.items) };
  }

  @Get('products/:id')
  async product(@Param('id') id: string) {
    if (!isObjectIdOrHexString(id)) throw new NotFoundException();
    const product = await this.products.findOne({ _id: id, isActive: true }).select(productFields).lean();
    if (!product) throw new NotFoundException();
    const [view] = await this.withPrices([product]);
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

  private async withPrices<T extends Pick<Product, 'kind' | 'basePrice' | 'masterId' | 'priceAdjustment'>>(rows: T[]) {
    const masterIds = rows.flatMap(row => row.kind === 'variant' && row.masterId ? [row.masterId] : []);
    if (masterIds.length === 0) return rows;
    const masters = await this.products.find({ _id: { $in: masterIds }, kind: 'master', isActive: true }).select('basePrice').lean();
    const prices = new Map(masters.map(master => [String(master._id), master.basePrice]));
    return rows.map(row => {
      const base = prices.get(String(row.masterId));
      if (row.kind !== 'variant' || !base) return row;
      return { ...row, basePrice: { currency: base.currency, amount: base.amount + (row.priceAdjustment ?? 0) } };
    });
  }

  private async list<T>(model: Model<T>, { page, limit, search }: CatalogQueryDto, projection: string, searchable = ['name', 'slug']) {
    const escaped = search?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
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
