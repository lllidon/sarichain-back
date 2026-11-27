import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BrandsService } from '../../brands/brands.service';
import { Brand } from '../../brands/schemas/brand.schema';
import { CategoriesService } from '../../categories/categories.service';
import { Category } from '../../categories/schemas/category.schema';
import { ProductsService } from '../../products/products.service';
import { Product } from '../../products/schemas/product.schema';
import { demoProducts } from './demo-products';

import { demoBrands, demoCategories, demoProducts } from './demo-food-catalog';

function images(image: string) {
  return {
    imageUrl: '/img/catalog/field.webp',
    thumbnailUrl: '/img/catalog/field.webp',
  };
}

type RecordIdentity = { _id: Types.ObjectId };

async function ensureRecord<T extends RecordIdentity>(
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await find();
  if (existing) return existing;

  try {
    return await create();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      const concurrent = await find();
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

@Injectable()
export class CatalogDemoService {
  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(Category.name) private readonly categoryModel: Model<Category>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    private readonly brands: BrandsService,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
  ) {}

  async seed() {
    const database = this.productModel.db.db;
    if (!database) throw new Error('MongoDB is not connected.');
    const runs = database.collection<{ _id: string; completedAt: Date }>('catalog_seed_runs');
    const runId = 'food-market-demo-v2';
    if (await runs.findOne({ _id: runId })) return;

    const brandIds: Types.ObjectId[] = [];
    for (const [key, name, image] of demoBrands) {
      const slug = `demo-${key}`;
      const brand = await ensureRecord(
        () => this.brandModel.findOne({ slug }).exec(),
        () => this.brands.create({
          slug, name, ...images(image),
          shortDescription: 'تولیدکننده نمونه محصولات غذایی ساری‌چین',
        }),
      );
      brandIds.push(brand._id);
    }

    const categoryIds = new Map<string, Types.ObjectId>();
    for (const [key, name, parentKey, image] of demoCategories) {
      const slug = `demo-${key}`;
      const parentId = parentKey ? categoryIds.get(parentKey) : null;
      if (parentKey && !parentId) throw new Error(`Missing demo parent: ${parentKey}`);

      const category = await ensureRecord(
        () => this.categoryModel.findOne({ slug, parentId }).exec(),
        () => this.categories.create({ slug, name, parentId, ...images(image) }),
      );
      categoryIds.set(key, category._id);
    }

    for (const [index, row] of demoProducts.entries()) {
      const [code, name, category, price, unit, application, form, image] = row;
      const categoryId = categoryIds.get(category);
      if (!categoryId) throw new Error(`Missing demo category: ${category}`);

      const sku = `SC-${code}`;
      const slug = `demo-${image}`;
      const shortDescription = `${form} · ${application}`;
      const master = await ensureRecord(
        () => this.productModel.findOne({ sku, slug, kind: 'master', categoryId }).exec(),
        () => this.products.createMaster({
          name, sku, slug, categoryId, brandId: brandIds[index % brandIds.length],
          ...images(image), shortDescription,
          description: `${name} برای ${application}، به شکل ${form} و با قیمت پایه به ازای هر ${unit}.`,
          basePrice: { amount: price * 10, currency: 'IRR' },
        }),
      );

      if (index < 10) {
        const variantSku = `${sku}-P`;
        const variantSlug = `${slug}-premium`;
        const priceAdjustment = (Math.round(price * 1.12 / 1000) * 1000 - price) * 10;
        await ensureRecord(
          () => this.productModel.findOne({ sku: variantSku, slug: variantSlug, masterId: master._id }).exec(),
          () => this.products.createVariant({
            name: `${name} · ممتاز`, sku: variantSku, slug: variantSlug, masterId: master._id,
            ...images(image), shortDescription,
            priceAdjustment,
            options: [{ name: 'درجه کیفی', value: 'ممتاز' }],
          }),
        );
      }
    }
    await runs.updateOne({ _id: runId }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
  }
}
