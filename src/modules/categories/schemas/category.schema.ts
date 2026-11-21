import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CatalogEntry } from '../../catalog-common/catalog-entry';

@Schema({ collection: 'categories', timestamps: true, strict: 'throw' })
export class Category extends CatalogEntry {
  @Prop({ type: Types.ObjectId, ref: Category.name, default: null, immutable: true })
  parentId!: Types.ObjectId | null;

  @Prop({ required: true, enum: [1, 2, 3], immutable: true })
  level!: number;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.index({ parentId: 1, isActive: 1, name: 1 });

CategorySchema.pre('validate', function () {
  if ((this.level === 1) !== (this.parentId == null)) {
    this.invalidate('parentId', 'Only a first-level category may have no parent.');
  }
});
