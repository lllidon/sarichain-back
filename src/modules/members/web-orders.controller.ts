import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsMongoId, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import { Product } from '../products/schemas/product.schema';
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
      _id: string; signature: string; total: number; currency: string;
    }>('web_orders');
    const existing = await orders.findOne({ _id: id });
    if (existing) {
      if (existing.signature !== signature) throw new ConflictException('این شناسه درخواست قبلاً استفاده شده است.');
      return { id, total: existing.total, currency: existing.currency };
    }

    const records = await this.products.find({
      _id: { $in: request.map(item => item.productId) }, kind: 'master', isActive: true,
    }).select('name basePrice').lean();
    const products = new Map(records.map(product => [String(product._id), product]));
    const items = request.map(({ productId, quantity }) => {
      const product = products.get(productId);
      if (!product?.basePrice) throw new BadRequestException('یکی از محصولات برای سفارش در دسترس نیست.');
      return { productId, quantity, name: product.name, unitPrice: product.basePrice.amount, currency: product.basePrice.currency };
    });
    const currency = items[0].currency;
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    if (!Number.isSafeInteger(total) || items.some(item => item.currency !== currency)) {
      throw new BadRequestException('مبلغ یا ارز سفارش معتبر نیست.');
    }
    const saved = await orders.findOneAndUpdate({ _id: id }, { $setOnInsert: {
      memberId: member._id, signature, items, total, currency, status: 'pending', createdAt: new Date(),
    } }, { upsert: true, returnDocument: 'after' });
    if (!saved || saved.signature !== signature) throw new ConflictException('این شناسه درخواست قبلاً استفاده شده است.');
    return { id, total: saved.total, currency: saved.currency };
  }
}
