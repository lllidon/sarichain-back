import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { mobileNumberPattern } from '../phone';

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, match: mobileNumberPattern })
  phone!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
