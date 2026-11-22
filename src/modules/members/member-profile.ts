import { Prop } from '@nestjs/mongoose';

export abstract class MemberProfile {
  @Prop({ trim: true, maxlength: 160 }) fullName?: string;
  @Prop({ trim: true, lowercase: true, maxlength: 254 }) email?: string;
  @Prop({ trim: true, maxlength: 160 }) organization?: string;
  @Prop({ trim: true, maxlength: 100 }) province?: string;
  @Prop({ trim: true, maxlength: 100 }) city?: string;
  @Prop({ trim: true, maxlength: 500 }) address?: string;
  @Prop({ trim: true, maxlength: 1000 }) notes?: string;
  @Prop({ default: true }) isActive!: boolean;
}
