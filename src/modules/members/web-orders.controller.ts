import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsMongoId, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import { PriceRange, Product } from '../products/schemas/product.schema';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { MarketplaceAccounts } from './marketplace-account.service';

class OrderLineDto {
  @ApiProperty() @IsMongoId() productId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity!: number;
}

class WebOrderDto {
  @ApiProperty() @IsUUID('4') requestId!: string;
  @ApiProperty({ type: [OrderLineDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique((item: OrderLineDto) => item?.productId)
  @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
}

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/orders')
export class WebOrdersController {
  constructor(
    private readonly accounts: MarketplaceAccounts,
    @InjectModel(Product.name) private readonly products: Model<Product>,
  ) {}

  @Get()
  async list(@Headers('authorization') authorization: string | undefined, @Query() { page, limit }: CatalogQueryDto) {
    const member = await this.accounts.requireMember(authorization);
    const orders = this.products.db.db!.collection('web_orders');
    const filter = { memberId: member._id, status: { $nin: ['completed', 'cancelled'] } };
    const [items, total] = await Promise.all([
      orders.find(filter, { projection: { signature: 0, memberId: 0 } })
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      orders.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  @Post()
  async create(@Headers('authorization') authorization: string | undefined, @Body() input: WebOrderDto) {
    const member = await this.accounts.requireMember(authorization);
    const request = input.items.map(({ productId, quantity }) => ({ productId: productId.toLowerCase(), quantity }));
    if (new Set(request.map(item => item.productId)).size !== request.length) throw new BadRequestException('محصول تکراری است.');
    const signature = JSON.stringify(request);
    const id = createHash('sha256').update(member.id + ':' + input.requestId).digest('hex');
    const orders = this.products.db.db!.collection<{
      _id: string; signature: string; total: number; currency: string; price?: PriceRange;
    }>('web_orders');
    const existing = await orders.findOne({ _id: id });
    if (existing) {
      if (existing.signature !== signature) throw new ConflictException('این شناسه درخواست قبلاً استفاده شده است.');
      return { id, total: existing.total, currency: existing.currency, price: existing.price };
    }

    const records = await this.products.find({
      _id: { $in: request.map(item => item.productId) }, kind: 'master', isActive: true,
    }).select('name price').lean();
    const products = new Map(records.map(product => [String(product._id), product]));
    const items = request.map(({ productId, quantity }) => {
      const product = products.get(productId);
      if (!product) throw new BadRequestException('یکی از محصولات برای سفارش در دسترس نیست.');
      return { productId, quantity, name: product.name, price: product.price ?? { min: 0, max: 0 } };
    });
    const currency = 'KAR';
    const sum = (bound: keyof PriceRange) => items.reduce((total, item) =>
      total + Math.round(item.price[bound] * 1_000_000) * item.quantity, 0);
    const min = sum('min'), max = sum('max');
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) {
      throw new BadRequestException('بازه قیمت سفارش معتبر نیست.');
    }
    const price = { min: min / 1_000_000, max: max / 1_000_000 };
    const total = price.max;
    const saved = await orders.findOneAndUpdate({ _id: id }, { $setOnInsert: {
      memberId: member._id, signature, items, total, currency, price, status: 'pending', createdAt: new Date(),
    } }, { upsert: true, returnDocument: 'after' });
    if (!saved || saved.signature !== signature) throw new ConflictException('این شناسه درخواست قبلاً استفاده شده است.');
    return { id, total: saved.total, currency: saved.currency, price: saved.price };
  }
}
