import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Brand } from '../../brands/schemas/brand.schema';
import { CatalogEntry } from '../../catalog-common/catalog-entry';
import { Category } from '../../categories/schemas/category.schema';

export type ProductKind = 'master' | 'variant';

const integer = {
  validator: Number.isSafeInteger,
  message: 'Use a safe integer.',
};

const positive = {
  validator: (value: number) => Number.isFinite(value) && value > 0,
  message: 'Use a positive finite number.',
};

@Schema({ _id: false, strict: 'throw' })
export class PriceRange {
  @Prop({ required: true, min: 0, max: 1_000_000 })
  min!: number;

  @Prop({ required: true, min: 0, max: 1_000_000,
    validate: { validator(this: PriceRange, max: number) { return max >= this.min; }, message: 'Invalid price range.' } })
  max!: number;
}

@Schema({ _id: false, strict: 'throw' })
export class Money {
  @Prop({ required: true, min: 0, validate: integer })
  amount!: number;

  @Prop({ required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ })
  currency!: string;
}

@Schema({ _id: false, strict: 'throw' })
export class ShippingDimensions {
  @Prop({ required: true, validate: positive })
  lengthMm!: number;

  @Prop({ required: true, validate: positive })
  widthMm!: number;

  @Prop({ required: true, validate: positive })
  heightMm!: number;
}

@Schema({ _id: false, strict: 'throw' })
export class PhysicalSpecifications {
  @Prop({ validate: positive })
  standardDensityKgM3?: number;

  @Prop({ validate: positive })
  shippingWeightG?: number;

  @Prop({ type: SchemaFactory.createForClass(ShippingDimensions) })
  shippingDimensions?: ShippingDimensions;
}

@Schema({ _id: false, strict: 'throw' })
export class ProductOption {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ required: true, trim: true, maxlength: 160 })
  value!: string;
}

@Schema({ collection: 'products', timestamps: true, strict: 'throw' })
export class Product extends CatalogEntry {
  @Prop({ required: true, trim: true, uppercase: true, unique: true, maxlength: 64, match: /^[A-Z0-9][A-Z0-9._-]*$/ })
  sku!: string;

  @Prop({ trim: true, maxlength: 100, index: { sparse: true } })
  itemId?: string;

  @Prop({ type: String, required: true, enum: ['master', 'variant'], immutable: true })
  kind!: ProductKind;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Product.name, default: null, immutable: true })
  masterId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Category.name, required: true })
  categoryId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Brand.name, default: null })
  brandId!: Types.ObjectId | null;

  @Prop({ type: SchemaFactory.createForClass(Money) })
  basePrice?: Money;

  @Prop({ validate: integer })
  priceAdjustment?: number;

  @Prop({ type: SchemaFactory.createForClass(PriceRange) })
  price?: PriceRange | null;

  @Prop({ type: [SchemaFactory.createForClass(ProductOption)], default: [] })
  options!: ProductOption[];

  @Prop({ type: SchemaFactory.createForClass(PhysicalSpecifications) })
  physical?: PhysicalSpecifications;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ categoryId: 1, isActive: 1 });
ProductSchema.index({ brandId: 1, isActive: 1 });
ProductSchema.index({ masterId: 1, isActive: 1 });

ProductSchema.pre('validate', function () {
  if (this.kind === 'master') {
    if (this.masterId != null) this.invalidate('masterId', 'A master cannot reference another product.');
    if (this.basePrice == null) this.invalidate('basePrice', 'A master requires a base price.');
    if (this.priceAdjustment != null) this.invalidate('priceAdjustment', 'A master cannot have a price adjustment.');
  }

  if (this.kind === 'variant') {
    if (this.masterId == null) this.invalidate('masterId', 'A variant requires a master product.');
    if (this.basePrice != null) this.invalidate('basePrice', 'A variant inherits the master base price.');
    if (this.priceAdjustment == null) this.invalidate('priceAdjustment', 'A variant requires a price adjustment.');
  }
});
