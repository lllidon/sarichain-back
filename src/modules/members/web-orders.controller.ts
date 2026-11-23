import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsMongoId, IsIn, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import { PriceRange, Product } from '../products/schemas/product.schema';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { deliveryMethods, deliveryOptions, deliverySlots, resolveDelivery } from './web-delivery';
import { MarketplaceAccounts } from './marketplace-account.service';

class OrderLineDto {
  @ApiProperty() @IsMongoId() productId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity!: number;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,29}$/) unitId?: string;
}

class DeliveryDto {
  @ApiProperty({ enum: deliveryMethods }) @IsIn(deliveryMethods) method!: string;
  @ApiProperty() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dispatchDate!: string;
  @ApiProperty({ enum: deliverySlots.map(slot => slot.id) })
  @IsIn(deliverySlots.map(slot => slot.id)) slot!: string;
}

class WebOrderDto {
  @ApiProperty() @IsUUID('4') requestId!: string;
  @ApiProperty({ type: [OrderLineDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique((item: OrderLineDto) => item?.productId + ':' + (item?.unitId ?? 'unit'))
  @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
  @ApiProperty({ type: DeliveryDto, required: false })
  @IsOptional() @ValidateNested() @Type(() => DeliveryDto) delivery?: DeliveryDto;
}

@ApiTags('web')
@Controller('web/delivery-options')
export class WebDeliveryController {
  @Get()
  options() {
    return { methods: deliveryOptions() };
  }
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
    const request = input.items.map(({ productId, quantity, unitId }) => ({
      productId: productId.toLowerCase(), quantity, ...(unitId && unitId !== 'unit' && { unitId }),
    }));
    if (new Set(request.map(item => item.productId + ':' + (item.unitId ?? 'unit'))).size !== request.length) {
      throw new BadRequestException('واحد تکراری برای محصول ارسال شده است.');
    }
    const requestedDelivery = input.delivery && { method: input.delivery.method, dispatchDate: input.delivery.dispatchDate, slot: input.delivery.slot };
    const signature = JSON.stringify(requestedDelivery ? { items: request, delivery: requestedDelivery } : request);
    const id = createHash('sha256').update(member.id + ':' + input.requestId).digest('hex');
    const orders = this.products.db.db!.collection<{
      _id: string; signature: string; total: number; currency: string; price?: PriceRange; subtotal?: PriceRange; delivery?: ReturnType<typeof resolveDelivery>;
    }>('web_orders');
    const existing = await orders.findOne({ _id: id });
    if (existing) {
      if (existing.signature !== signature) throw new ConflictException('این شناسه درخواست قبلاً استفاده شده است.');
      return { id, total: existing.total, currency: existing.currency, price: existing.price, subtotal: existing.subtotal, delivery: existing.delivery };
    }

    const records = await this.products.find({
      _id: { $in: request.map(item => item.productId) }, kind: 'master', isActive: true,
    }).select('name price saleUnit saleUnits').lean();
    const products = new Map(records.map(product => [String(product._id), product]));
    const quantities = new Map<string, number>();
    const items = request.map(({ productId, quantity, unitId }) => {
      const product = products.get(productId);
      if (!product) throw new BadRequestException('یکی از محصولات برای سفارش در دسترس نیست.');
      const unit = unitId ? product.saleUnits?.find(option => option.code === unitId) : undefined;
      if (unitId && !unit) throw new BadRequestException('واحد فروش محصول در دسترس نیست.');
      const unitsPerPack = unit?.quantity ?? 1;
      const baseQuantity = quantity * unitsPerPack;
      const accumulated = (quantities.get(productId) ?? 0) + baseQuantity;
      if (!Number.isSafeInteger(accumulated) || accumulated > 1000) {
        throw new BadRequestException('حداکثر تعداد مجاز هر محصول ۱۰۰۰ واحد اصلی است.');
      }
      quantities.set(productId, accumulated);
      return {
        productId, quantity, baseQuantity, name: product.name, unitId: unitId ?? 'unit',
        unitName: unit?.name ?? (product.saleUnit || 'واحد'), unitsPerPack,
        price: product.price ?? { min: 0, max: 0 },
      };
    });
    const delivery = requestedDelivery ? resolveDelivery(requestedDelivery) : undefined;
    const currency = 'KAR';
    const sum = (bound: keyof PriceRange) => items.reduce((total, item) =>
      total + Math.round(item.price[bound] * 1_000_000) * item.baseQuantity, 0);
    const min = sum('min'), max = sum('max');
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) {
      throw new BadRequestException('بازه قیمت سفارش معتبر نیست.');
    }
    const shipping = Math.round((delivery?.fee ?? 0) * 1_000_000);
    if (!Number.isSafeInteger(max + shipping)) throw new BadRequestException('مبلغ سفارش بیش از حد مجاز است.');
    const subtotal = { min: min / 1_000_000, max: max / 1_000_000 };
    const price = { min: (min + shipping) / 1_000_000, max: (max + shipping) / 1_000_000 };
    const total = price.max;
    const saved = await orders.findOneAndUpdate({ _id: id }, { $setOnInsert: {
      memberId: member._id, signature, items, total, currency, price, subtotal, ...(delivery && { delivery }), status: 'pending', createdAt: new Date(),
    } }, { upsert: true, returnDocument: 'after' });
    if (!saved || saved.signature !== signature) throw new ConflictException('این شناسه درخواست قبلاً استفاده شده است.');
    return { id, total: saved.total, currency: saved.currency, price: saved.price, subtotal: saved.subtotal, delivery: saved.delivery };
  }
}
