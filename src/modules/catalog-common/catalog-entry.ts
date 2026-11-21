import { Prop } from '@nestjs/mongoose';

const imageUrl = {
  validator: (value: string) => /^(https?:\/\/[^\s/]+|\/(?!\/))\S*$/i.test(value),
  message: 'Use an HTTP(S) image URL or a root-relative path.',
};

export abstract class CatalogEntry {
  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 160, unique: true, match: /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u })
  slug!: string;

  @Prop({ trim: true, maxlength: 2048, validate: imageUrl })
  imageUrl?: string;

  @Prop({ trim: true, maxlength: 2048, validate: imageUrl })
  thumbnailUrl?: string;

  @Prop({ trim: true, maxlength: 500 })
  shortDescription?: string;

  @Prop({ trim: true, maxlength: 20_000 })
  description?: string;

  @Prop({ default: true })
  isActive!: boolean;
}

export type CatalogEntryInput = Pick<CatalogEntry, 'name' | 'slug'> &
  Partial<Omit<CatalogEntry, 'name' | 'slug'>>;
