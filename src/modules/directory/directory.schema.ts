import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ collection: 'material_suppliers', timestamps: true, strict: 'throw', optimisticConcurrency: true })
export class MaterialSupplier {
  @Prop({ required: true, trim: true, maxlength: 160 }) name!: string;
  @Prop({ trim: true, maxlength: 120 }) contactName?: string;
  @Prop({ required: true }) phone!: string;
  @Prop() alternatePhone?: string;
  @Prop({ trim: true, lowercase: true }) email?: string;
  @Prop() website?: string;
  @Prop({ required: true }) province!: string;
  @Prop({ required: true }) city!: string;
  @Prop() address?: string;
  @Prop() hours?: string;
  @Prop() description?: string;
  @Prop({ type: [{ type: MongoSchema.Types.ObjectId, ref: 'Tag' }], default: [] }) tagIds!: Types.ObjectId[];
  @Prop({ default: false }) isActive!: boolean;
  @Prop({ default: 0, min: 0, max: 100 }) priority!: number;
  @Prop({ default: 0, min: 0 }) feedbackCount!: number;
  @Prop({ default: 0, min: 0 }) positiveFeedbackCount!: number;
  @Prop({ default: 0.5, min: 0, max: 1 }) feedbackScore!: number;
}

export const MaterialSupplierSchema = SchemaFactory.createForClass(MaterialSupplier);
MaterialSupplierSchema.index({ isActive: 1, priority: -1, feedbackScore: -1, feedbackCount: -1, _id: 1 });
MaterialSupplierSchema.index({ tagIds: 1, isActive: 1 });
