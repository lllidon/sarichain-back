import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model, Types } from 'mongoose';
import { BrandsService } from '../brands/brands.service';
import { Brand } from '../brands/schemas/brand.schema';
import { CatalogEntryInput } from '../catalog-common/catalog-entry';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/schemas/category.schema';
import { ProductsService } from '../products/products.service';
import { Product } from '../products/schemas/product.schema';
import { CatalogCollection } from './catalog-collection';
import { CatalogWriteDto } from './catalog-write.dto';
import { normalizeTagName, Tag } from './tag.schema';

const commonKeys = ['name', 'slug', 'imageUrl', 'thumbnailUrl', 'shortDescription', 'description', 'isActive', 'tagIds'];
const specificKeys: Record<CatalogCollection, string[]> = {
  [CatalogCollection.Brands]: [],
  [CatalogCollection.Categories]: ['parentId'],
  [CatalogCollection.Products]: ['sku', 'itemId', 'categoryId', 'brandId', 'kind', 'masterId', 'basePrice', 'price', 'priceAdjustment', 'physical', 'options'],
};

const idOf = (id: string) => new Types.ObjectId(id);

@Injectable()
export class CatalogWriteService {
  private pending = Promise.resolve();

  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(Category.name) private readonly categoryModel: Model<Category>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    @InjectModel(Tag.name) private readonly tagModel: Model<Tag>,
    private readonly brands: BrandsService,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
  ) {}

  private write<T>(operation: () => Promise<T>) {
    // Serialize relationship checks and writes within this API instance.
    const result = this.pending.then(operation).catch((error: unknown) => {
      if (error instanceof MongooseError.ValidationError || error instanceof MongooseError.StrictModeError) {
        throw new BadRequestException('مقادیر واردشده با ساختار رکورد مطابقت ندارند.');
      }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException('شناسه یا نشانی واردشده تکراری است.');
      }
      throw error;
    });
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async createTag(name: string) {
    const cleaned = normalizeTagName(name);
    if (!cleaned || cleaned.length > 60) throw new BadRequestException('نام تگ معتبر نیست.');
    const key = cleaned.toLowerCase();
    await this.tagModel.init();
    try {
      const tag = await this.tagModel.findOneAndUpdate({ key }, { $setOnInsert: { name: cleaned } }, { upsert: true, returnDocument: 'after', runValidators: true }).exec();
      return { _id: tag._id, name: tag.name };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        const tag = await this.tagModel.findOne({ key }).orFail();
        return { _id: tag._id, name: tag.name };
      }
      throw error;
    }
  }

  save(collection: CatalogCollection, input: CatalogWriteDto, id?: string) {
    return this.write(async () => {
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (!commonKeys.includes(key) && !specificKeys[collection].includes(key)) {
          throw new BadRequestException('این فیلد برای این فهرست معتبر نیست.');
        }
        if (value === null && !['parentId', 'brandId', 'price'].includes(key)) {
          throw new BadRequestException('مقدار خالی برای این فیلد معتبر نیست.');
        }
      }

      const shared = Object.fromEntries(commonKeys.filter(key => input[key as keyof CatalogWriteDto] !== undefined)
        .map(key => [key, input[key as keyof CatalogWriteDto]])) as Partial<CatalogEntryInput>;
      if (input.tagIds !== undefined) {
        const ids = input.tagIds.map(idOf);
        if (await this.tagModel.countDocuments({ _id: { $in: ids } }) !== ids.length) {
          throw new BadRequestException('یک یا چند تگ انتخاب‌شده وجود ندارد.');
        }
        shared.tagIds = ids;
      }
      if (!id && (!shared.name?.trim() || !shared.slug?.trim())) {
        throw new BadRequestException('نام و نشانی الزامی هستند.');
      }
      if (collection === CatalogCollection.Brands) {
        if (!id) return this.brands.create(shared as CatalogEntryInput);
        const brand = await this.brandModel.findById(id).exec();
        if (!brand) throw new NotFoundException();
        return brand.set(shared).save();
      }

      if (collection === CatalogCollection.Categories) {
        if (!id) return this.categories.create({ ...shared as CatalogEntryInput, parentId: input.parentId ? idOf(input.parentId) : null });
        return this.editCategory(id, input, shared);
      }
      return this.saveProduct(id, input, shared);
    });
  }

  private async editCategory(id: string, input: CatalogWriteDto, shared: Partial<CatalogEntryInput>) {
    const category = await this.categoryModel.findById(id).exec();
    if (!category) throw new NotFoundException();
    if (input.parentId !== undefined && input.parentId !== (category.parentId?.toString() ?? null)) {
      const parent = input.parentId ? await this.categoryModel.findById(input.parentId).exec() : null;
      if (input.parentId && !parent) throw new BadRequestException('دسته والد وجود ندارد.');
      for (let ancestor = parent; ancestor;) {
        if (ancestor._id.equals(category._id)) throw new BadRequestException('دسته یا زیرشاخه آن نمی‌تواند والد باشد.');
        ancestor = ancestor.parentId ? await this.categoryModel.findById(ancestor.parentId).exec() : null;
      }
      const level = (parent?.level ?? 0) + 1;
      if (level > 3) throw new BadRequestException('عمق دسته‌بندی حداکثر سه سطح است.');
      if (level !== category.level && await this.categoryModel.exists({ parentId: id })) {
        throw new ConflictException('تغییر سطح دسته دارای زیرشاخه مجاز نیست. ابتدا زیرشاخه‌ها را جابه‌جا کنید.');
      }
      if (level === 1 && await this.productModel.exists({ categoryId: id })) {
        throw new ConflictException('دسته دارای محصول نمی‌تواند به سطح اول منتقل شود.');
      }
      category.set({ parentId: parent?._id ?? null, level });
    }
    return category.set(shared).save();
  }

  private async saveProduct(id: string | undefined, input: CatalogWriteDto, shared: Partial<CatalogEntryInput>) {
    const product = id ? await this.productModel.findById(id).exec() : null;
    if (id && !product) throw new NotFoundException();
    if (input.price && input.price.min > input.price.max) {
      throw new BadRequestException('حداکثر قیمت باید برابر یا بیشتر از حداقل باشد.');
    }
    const priceFields = input.price === undefined ? {} : { price: input.price };
    const kind = product?.kind ?? input.kind ?? 'master';
    if (product && input.kind && input.kind !== kind) throw new BadRequestException('نوع محصول پس از ایجاد ثابت است.');

    const fields = {
      ...shared,
      ...priceFields,
      ...(input.sku !== undefined && { sku: input.sku }),
      ...(input.itemId !== undefined && { itemId: input.itemId }),
      ...(input.physical !== undefined && { physical: input.physical }),
      ...(input.options !== undefined && { options: input.options }),
    };

    if (kind === 'variant') {
      if (input.categoryId !== undefined || input.brandId !== undefined || input.basePrice !== undefined) {
        throw new BadRequestException('گزینه، دسته و برند و قیمت پایه را از محصول اصلی می‌گیرد.');
      }
      if (!product) {
        if (!input.masterId || !input.sku) throw new BadRequestException('SKU و محصول اصلی الزامی هستند.');
        return this.products.createVariant({ ...fields as CatalogEntryInput, ...priceFields, sku: input.sku, itemId: input.itemId,
          physical: input.physical, options: input.options, masterId: idOf(input.masterId), priceAdjustment: input.priceAdjustment });
      }
      if (input.masterId && input.masterId !== product.masterId?.toString()) {
        throw new BadRequestException('محصول اصلی گزینه پس از ایجاد ثابت است.');
      }
      const master = await this.productModel.findById(product.masterId).exec();
      const adjusted = (master?.basePrice?.amount ?? -1) + (input.priceAdjustment ?? product.priceAdjustment ?? 0);
      if (!master?.basePrice || !Number.isSafeInteger(adjusted) || adjusted < 0) {
        throw new BadRequestException('قیمت نهایی گزینه معتبر نیست.');
      }
      if (input.priceAdjustment !== undefined) product.priceAdjustment = input.priceAdjustment;
      return product.set(fields).save();
    }

    if (input.masterId !== undefined || input.priceAdjustment !== undefined) {
      throw new BadRequestException('محصول اصلی نمی‌تواند به محصول دیگری وابسته باشد.');
    }
    if (!product) {
      if (!input.sku || !input.categoryId) throw new BadRequestException('SKU و دسته‌بندی الزامی هستند.');
      return this.products.createMaster({ ...fields as CatalogEntryInput, ...priceFields, sku: input.sku, itemId: input.itemId,
        physical: input.physical, categoryId: idOf(input.categoryId), brandId: input.brandId ? idOf(input.brandId) : undefined, basePrice: input.basePrice ?? { amount: 0, currency: 'IRR' } });
    }

    const categoryChanged = input.categoryId !== undefined && input.categoryId !== product.categoryId.toString();
    const brandChanged = input.brandId !== undefined && input.brandId !== (product.brandId?.toString() ?? null);
    if ((categoryChanged || brandChanged) && await this.productModel.exists({ masterId: id })) {
      throw new ConflictException('دسته یا برند محصول اصلیِ دارای گزینه قابل تغییر نیست.');
    }
    if (categoryChanged && input.categoryId) {
      if (!await this.categories.acceptsProducts(idOf(input.categoryId))) throw new BadRequestException('دسته سطح دوم یا سوم معتبر انتخاب کنید.');
      product.categoryId = idOf(input.categoryId);
    }
    if (brandChanged) {
      if (input.brandId && !await this.brands.exists(idOf(input.brandId))) throw new BadRequestException('برند انتخاب‌شده وجود ندارد.');
      product.brandId = input.brandId ? idOf(input.brandId) : null;
    }
    if (input.basePrice) {
      const adjustments = await this.productModel.find({ masterId: id }).select('priceAdjustment').lean().exec();
      if (adjustments.some(row => {
        const amount = input.basePrice!.amount + (row.priceAdjustment ?? 0);
        return !Number.isSafeInteger(amount) || amount < 0;
      })) throw new ConflictException('این قیمت پایه، قیمت یک گزینه را نامعتبر می‌کند.');
      product.basePrice = input.basePrice;
    }
    return product.set(fields).save();
  }

  delete(collection: CatalogCollection, id: string) {
    return this.write(async () => {
      let deleted: { deletedCount: number };
      if (collection === CatalogCollection.Brands) {
        if (await this.productModel.exists({ brandId: id })) throw new ConflictException('این برند به محصولی متصل است.');
        deleted = await this.brandModel.deleteOne({ _id: id });
      } else if (collection === CatalogCollection.Categories) {
        if (await this.categoryModel.exists({ parentId: id }) || await this.productModel.exists({ categoryId: id })) {
          throw new ConflictException('این دسته زیردسته یا محصول دارد.');
        }
        deleted = await this.categoryModel.deleteOne({ _id: id });
      } else {
        if (await this.productModel.exists({ masterId: id })) throw new ConflictException('این محصول گزینه وابسته دارد.');
        deleted = await this.productModel.deleteOne({ _id: id });
      }
      if (!deleted.deletedCount) throw new NotFoundException();
    });
  }
}
