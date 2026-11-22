import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

abstract class Location {
  @Prop({ required: true, unique: true, match: /^\d{1,10}$/ }) code!: string;
  @Prop({ required: true, trim: true }) name!: string;
}

@Schema({ collection: 'provinces', versionKey: false })
export class Province extends Location {}

@Schema({ collection: 'cities', versionKey: false })
export class City extends Location {
  @Prop({ required: true, match: /^\d{1,10}$/ }) provinceCode!: string;
}

const CitySchema = SchemaFactory.createForClass(City);
CitySchema.index({ provinceCode: 1, name: 1, code: 1 });

export const locationModels = [
  { name: Province.name, schema: SchemaFactory.createForClass(Province) },
  { name: City.name, schema: CitySchema },
];
