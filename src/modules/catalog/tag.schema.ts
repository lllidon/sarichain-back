import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'tags', timestamps: true })
export class Tag {
  @Prop({ required: true, maxlength: 60 })
  name!: string;

  @Prop({ required: true, unique: true, select: false })
  key!: string;
}

export const TagSchema = SchemaFactory.createForClass(Tag);

export function normalizeTagName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
}
