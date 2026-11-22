import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { mobileNumberPattern } from '../auth/phone';
import { MemberProfile } from './member-profile';
import { MemberGroup, memberTypes } from './member-types';

abstract class ExternalMember extends MemberProfile {
  @Prop({ required: true, unique: true, match: mobileNumberPattern }) phone!: string;
}

@Schema({ collection: 'customers', timestamps: true, strict: 'throw' })
export class Customer extends ExternalMember {
  @Prop({ required: true, enum: memberTypes[MemberGroup.Customers] }) type!: string;
}

@Schema({ collection: 'producers', timestamps: true, strict: 'throw' })
export class Producer extends ExternalMember {
  @Prop({ required: true, enum: memberTypes[MemberGroup.Producers] }) type!: string;
  @Prop({ trim: true, maxlength: 180 }) productionActivity?: string;
}

@Schema({ collection: 'service_providers', timestamps: true, strict: 'throw' })
export class ServiceProvider extends ExternalMember {
  @Prop({ required: true, enum: memberTypes[MemberGroup.Services] }) type!: string;
  @Prop({ trim: true, maxlength: 180 }) serviceArea?: string;
}

@Schema({ collection: 'member_phones', versionKey: false })
export class MemberPhone {
  @Prop({ type: String }) _id!: string;
  @Prop({ required: true, enum: Object.values(MemberGroup) }) group!: MemberGroup;
  @Prop({ required: true }) memberId!: string;
}

export const memberModels = [
  { name: Customer.name, schema: SchemaFactory.createForClass(Customer) },
  { name: Producer.name, schema: SchemaFactory.createForClass(Producer) },
  { name: ServiceProvider.name, schema: SchemaFactory.createForClass(ServiceProvider) },
  { name: MemberPhone.name, schema: SchemaFactory.createForClass(MemberPhone) },
];
