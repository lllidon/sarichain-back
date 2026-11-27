import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'home_slides', timestamps: true, strict: 'throw' })
export class HomeSlide {
  @Prop({ required: true, trim: true, maxlength: 120 }) eyebrow!: string;
  @Prop({ required: true, trim: true, maxlength: 180 }) title!: string;
  @Prop({ required: true, trim: true, maxlength: 500 }) description!: string;
  @Prop({ required: true, trim: true, maxlength: 2048 }) imageUrl!: string;
  @Prop({ required: true, trim: true, maxlength: 180 }) imageAlt!: string;
  @Prop({ required: true, trim: true, maxlength: 60 }) cta!: string;
  @Prop({ required: true, trim: true, maxlength: 2048 }) href!: string;
  @Prop({ type: Number, default: 0, min: 0, max: 10000 }) order!: number;
  @Prop({ type: Boolean, default: true }) isActive!: boolean;
}
export const HomeSlideSchema = SchemaFactory.createForClass(HomeSlide);
HomeSlideSchema.index({ isActive: 1, order: 1 });
