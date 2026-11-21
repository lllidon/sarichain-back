import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { mobileNumberPattern } from '../phone';

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ unique: true, match: mobileNumberPattern, required: function (this: User) { return !this.username; } })
  phone?: string;

  @Prop({ unique: true, sparse: true, trim: true, lowercase: true, match: /^[a-z][a-z0-9._-]{2,31}$/ })
  username?: string;

  @Prop({ type: String, enum: ['admin'] })
  role?: 'admin';

  @Prop({ required: true, select: false })
  passwordHash!: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
