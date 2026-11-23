import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogWriteService } from './catalog-write.service';
import { Tag, TagSchema } from './tag.schema';
import { AuthModule } from '../auth/auth.module';
import { BrandsModule } from '../brands/brands.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CatalogDemoService } from './demo/catalog-demo.service';
import { WebCatalogController } from './web-catalog.controller';
import { CatalogImagesController } from './catalog-images.controller';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [AuthModule, BrandsModule, CategoriesModule, ProductsModule, MongooseModule.forFeature([{ name: Tag.name, schema: TagSchema }])],
  exports: [MongooseModule],
  controllers: [CatalogController, WebCatalogController, CatalogImagesController],
  providers: [AccessTokenGuard, AdminGuard, CatalogDemoService, CatalogWriteService],
})
export class CatalogModule {}
