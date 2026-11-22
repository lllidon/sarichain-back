import { Schema as MongoSchema, Types } from 'mongoose';
import { Prop } from '@nestjs/mongoose';

export abstract class MemberProfile {
  @Prop({ trim: true, maxlength: 160 }) fullName?: string;
  @Prop({ trim: true, lowercase: true, maxlength: 254 }) email?: string;
  @Prop({ trim: true, maxlength: 160 }) organization?: string;
  @Prop({ trim: true, maxlength: 100 }) province?: string;
  @Prop({ trim: true, maxlength: 100 }) city?: string;
  @Prop({ maxlength: 10 }) provinceCode?: string;
  @Prop({ maxlength: 10 }) cityCode?: string;
  @Prop({ trim: true, maxlength: 500 }) address?: string;
  @Prop({ trim: true, maxlength: 1000 }) notes?: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Branch', index: true }) branchId?: Types.ObjectId;
  @Prop({ default: true }) isActive!: boolean;
}
