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

const demoBrands = [
  ['sarv', 'سرو سبز', 'bio-boost'],
  ['baran', 'کشت باران', 'fruit-pro'],
  ['rooyesh', 'رویش مازندران', 'soil-life'],
  ['aftab', 'طلوع آفتاب شمال', 'kelp'],
] as const;

const demoCategories = [
  ['plant-nutrition', 'تغذیه گیاه', null, 'bio-boost'],
  ['soil-care', 'مدیریت خاک', null, 'soil-life'],
  ['biological-inputs', 'نهاده‌های زیستی', null, 'nitro-fix'],
  ['biostimulants', 'محرک رشد', 'plant-nutrition', 'root-max'],
  ['specialty', 'تغذیه تخصصی', 'plant-nutrition', 'amino-grow'],
  ['soil-conditioners', 'بهبوددهنده خاک', 'soil-care', 'humic-acid'],
  ['organic-amendments', 'مواد آلی خاک', 'soil-care', 'compost'],
  ['biofertilizers', 'کود زیستی', 'biological-inputs', 'phos-bio'],
  ['microbial-root', 'تغذیه میکروبی ریشه', 'biological-inputs', 'root-bio'],
  ['vegetative', 'رشد رویشی', 'biostimulants', 'bio-boost'],
  ['root-development', 'ریشه‌زایی', 'biostimulants', 'root-max'],
  ['fruit-development', 'رشد میوه', 'biostimulants', 'fruit-pro'],
  ['stress-tolerance', 'مقاومت به تنش', 'biostimulants', 'kelp'],
  ['flowering', 'گل‌دهی', 'biostimulants', 'bloom'],
] as const;

function images(image: string) {
  return {
    imageUrl: `/catalog-demo/${image}.webp`,
    thumbnailUrl: `/catalog-demo/${image}-thumb.webp`,
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
    const brandIds: Types.ObjectId[] = [];
    for (const [key, name, image] of demoBrands) {
      const slug = `demo-${key}`;
      const brand = await ensureRecord(
        () => this.brandModel.findOne({ slug }).exec(),
        () => this.brands.create({
          slug, name, ...images(image),
          shortDescription: 'برند نمونه کاتالوگ کشاورزی ساری چین',
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
  }
}
