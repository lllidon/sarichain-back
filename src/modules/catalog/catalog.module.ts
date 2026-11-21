import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandsModule } from '../brands/brands.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [AuthModule, BrandsModule, CategoriesModule, ProductsModule],
  controllers: [CatalogController],
  providers: [AccessTokenGuard],
})
export class CatalogModule {}
