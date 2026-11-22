import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

abstract class OrganizationEntry {
  @Prop({ required: true, trim: true, maxlength: 140 }) name!: string;
  @Prop({ required: true, trim: true, lowercase: true, unique: true, match: /^[a-z0-9][a-z0-9-]{0,39}$/ }) code!: string;
  @Prop({ trim: true, maxlength: 600 }) description?: string;
}

@Schema({ collection: 'branches', timestamps: true })
export class Branch extends OrganizationEntry {
  @Prop({ trim: true, maxlength: 100 }) city?: string;
}

@Schema({ collection: 'profiles', timestamps: true })
export class Profile extends OrganizationEntry {}

@Schema({ collection: 'orders', timestamps: true })
export class BranchOrder {
  @Prop({ required: true, type: MongoSchema.Types.ObjectId, ref: Branch.name }) branchId!: Types.ObjectId;
  @Prop({ required: true }) number!: string;
  @Prop({ required: true }) status!: string;
}

const OrderSchema = SchemaFactory.createForClass(BranchOrder);
OrderSchema.index({ branchId: 1, _id: -1 });

export const organizationModels = [
  { name: Branch.name, schema: SchemaFactory.createForClass(Branch) },
  { name: Profile.name, schema: SchemaFactory.createForClass(Profile) },
  { name: BranchOrder.name, schema: OrderSchema },
];
