import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { mobileNumberPattern } from '../auth/phone';
import { MemberProfile } from './member-profile';
import { MemberGroup, memberTypes, reviewStates, vehicleTypes } from './member-types';

@Schema({ _id: false })
export class RoleReview {
  @Prop({ required: true, enum: reviewStates }) status!: 'pending' | 'approved' | 'rejected';
  @Prop() reviewedAt?: Date;
  @Prop() reviewedBy?: string;
}

@Schema({ _id: false })
export class Vehicle {
  @Prop({ required: true, enum: vehicleTypes }) type!: string;
  @Prop({ required: true, trim: true, maxlength: 40 }) plate!: string;
  @Prop({ required: true, trim: true, maxlength: 80 }) license!: string;
}

const ReviewSchema = SchemaFactory.createForClass(RoleReview);

@Schema({ collection: 'members', timestamps: true, strict: 'throw', optimisticConcurrency: true })
export class MarketplaceMember extends MemberProfile {
  @Prop({ required: true, unique: true, match: mobileNumberPattern }) phone!: string;
  @Prop({ select: false }) passwordHash?: string;
  @Prop({ enum: memberTypes[MemberGroup.Customers], default: 'consumer' }) customerType!: string;
  @Prop({ enum: memberTypes[MemberGroup.Producers] }) producerType?: string;
  @Prop({ type: [String], enum: memberTypes[MemberGroup.Services], default: [] }) serviceTypes!: string[];
  @Prop({ trim: true, maxlength: 180 }) productionActivity?: string;
  @Prop({ trim: true, maxlength: 180 }) serviceArea?: string;
  @Prop({ trim: true, maxlength: 120 }) serviceCredential?: string;
  @Prop({ type: SchemaFactory.createForClass(Vehicle) }) vehicle?: Vehicle;
  @Prop({ type: ReviewSchema }) sellerReview?: RoleReview;
  @Prop({ type: ReviewSchema }) driverReview?: RoleReview;
  @Prop({ type: ReviewSchema }) specialistReview?: RoleReview;
}

const MarketplaceMemberSchema = SchemaFactory.createForClass(MarketplaceMember);
MarketplaceMemberSchema.index({ customerType: 1, branchId: 1, _id: 1 });
MarketplaceMemberSchema.index({ producerType: 1, branchId: 1, _id: 1 });
MarketplaceMemberSchema.index({ serviceTypes: 1, branchId: 1, _id: 1 });

@Schema({ collection: 'member_phones', versionKey: false })
export class MemberPhone {
  @Prop({ type: String }) _id!: string;
  @Prop({ required: true, enum: [...Object.values(MemberGroup), 'marketplace'] }) group!: MemberGroup | 'marketplace';
  @Prop({ required: true }) memberId!: string;
}

export const memberModels = [
  { name: MarketplaceMember.name, schema: MarketplaceMemberSchema },
  { name: MemberPhone.name, schema: SchemaFactory.createForClass(MemberPhone) },
];
