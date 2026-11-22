import { Prop } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

const imageUrl = {
  validator: (value: string) => /^(https?:\/\/[^\s/]+|\/(?!\/))\S*$/i.test(value),
  message: 'Use an HTTP(S) image URL or a root-relative path.',
};

export abstract class CatalogEntry {
  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 160, unique: true, match: /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u })
  slug!: string;

  @Prop({ trim: true, maxlength: 2048, set: (value: string) => value?.trim() || undefined, validate: imageUrl })
  imageUrl?: string;

  @Prop({ trim: true, maxlength: 2048, set: (value: string) => value?.trim() || undefined, validate: imageUrl })
  thumbnailUrl?: string;

  @Prop({ trim: true, maxlength: 500 })
  shortDescription?: string;

  @Prop({ trim: true, maxlength: 20_000 })
  description?: string;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Tag' }], default: [] })
  tagIds!: Types.ObjectId[];

  @Prop({ default: true })
  isActive!: boolean;
}

export type CatalogEntryInput = Pick<CatalogEntry, 'name' | 'slug'> &
  Partial<Omit<CatalogEntry, 'name' | 'slug'>>;
