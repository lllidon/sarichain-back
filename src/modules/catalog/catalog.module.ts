import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandsModule } from '../brands/brands.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CatalogDemoService } from './demo/catalog-demo.service';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [AuthModule, BrandsModule, CategoriesModule, ProductsModule],
  controllers: [CatalogController],
  providers: [AccessTokenGuard, CatalogDemoService],
})
export class CatalogModule {}
