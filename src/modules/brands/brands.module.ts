import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BrandsService } from './brands.service';
import { Brand, BrandSchema } from './schemas/brand.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Brand.name, schema: BrandSchema }])],
  providers: [BrandsService],
  exports: [BrandsService, MongooseModule],
})
export class BrandsModule {}
