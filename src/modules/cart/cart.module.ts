import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CartCatalog } from './cart-catalog';
import { CartService } from './cart.service';

@Module({ imports: [ProductsModule], providers: [CartCatalog, CartService], exports: [CartService] })
export class CartModule {}
