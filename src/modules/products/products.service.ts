import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BrandsService } from '../brands/brands.service';
import { CatalogEntryInput } from '../catalog-common/catalog-entry';
import { CategoriesService } from '../categories/categories.service';
import { Money, PhysicalSpecifications, Product, ProductOption } from './schemas/product.schema';

type ProductInput = CatalogEntryInput & {
  sku: string;
  itemId?: string;
  physical?: PhysicalSpecifications;
};

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly categories: CategoriesService,
    private readonly brands: BrandsService,
  ) {}

  async createMaster(input: ProductInput & { categoryId: Types.ObjectId; brandId?: Types.ObjectId; basePrice: Money }) {
    if (!input.basePrice) throw new BadRequestException('Master products require a base price.');

    const [categoryExists, brandExists] = await Promise.all([
      this.categories.acceptsProducts(input.categoryId),
      input.brandId ? this.brands.exists(input.brandId) : true,
    ]);
    if (!categoryExists) throw new BadRequestException('Select an existing second- or third-level category.');
    if (!brandExists) throw new BadRequestException('Brand does not exist.');

    await this.products.init();
    return this.products.create({ ...input, kind: 'master', masterId: null });
  }

  async createVariant(input: ProductInput & { masterId: Types.ObjectId; priceAdjustment?: number; options?: ProductOption[] }) {
    const master = await this.products.findOne({ _id: input.masterId, kind: 'master' }).lean().exec();
    if (!master?.basePrice) throw new BadRequestException('A variant must reference a master product with a base price.');
    if (!await this.categories.acceptsProducts(master.categoryId)) {
      throw new BadRequestException('The master must belong to a second- or third-level category.');
    }

    const priceAdjustment = input.priceAdjustment ?? 0;
    const calculated = master.basePrice.amount + priceAdjustment;
    if (!Number.isSafeInteger(priceAdjustment) || !Number.isSafeInteger(calculated) || calculated < 0) {
      throw new BadRequestException('Variant price must be a non-negative safe integer.');
    }

    await this.products.init();
    return this.products.create({
      ...input,
      kind: 'variant',
      categoryId: master.categoryId,
      brandId: master.brandId,
      priceAdjustment,
    });
  }
}
