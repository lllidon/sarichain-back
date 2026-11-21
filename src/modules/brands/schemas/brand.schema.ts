import { Schema, SchemaFactory } from '@nestjs/mongoose';
import { CatalogEntry } from '../../catalog-common/catalog-entry';

@Schema({ collection: 'brands', timestamps: true, strict: 'throw' })
export class Brand extends CatalogEntry {}

export const BrandSchema = SchemaFactory.createForClass(Brand);
