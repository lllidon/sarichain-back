import { BadRequestException, Body, ConflictException, Controller, Get, Header, Headers, Post, Query } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDefined, IsInt, IsMongoId, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { createHash } from 'node:crypto';
import { Connection, Model } from 'mongoose';
import { PriceRange, Product } from '../products/schemas/product.schema';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { CartService } from '../cart/cart.service';
import { producerOffers } from '../catalog/producer-offers';
import { deliveryMethods, deliverySlots, quoteBasketDelivery, resolveDelivery } from './web-delivery';
import { MarketplaceAccounts } from './marketplace-account.service';
import { OrderPersistenceService } from './order-persistence.service';

class OrderLineDto {
  @ApiProperty() @IsMongoId() productId!: string;
  @IsOptional() @IsMongoId() offerId?: string;
  @ApiProperty() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) quantity!: number;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,29}$/) unitId?: string;
}

class DeliveryPointDto {
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

class DeliveryDto {
  @ApiProperty({ enum: deliveryMethods }) @IsIn(deliveryMethods) method!: string;
  @ApiProperty() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dispatchDate!: string;
  @ApiProperty({ enum: deliverySlots.map(slot => slot.id) })
  @IsIn(deliverySlots.map(slot => slot.id)) slot!: string;
  @ApiProperty({ type: DeliveryPointDto }) @IsDefined() @ValidateNested() @Type(() => DeliveryPointDto) destination!: DeliveryPointDto;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100000000) quotedFee!: number;
  @ApiProperty({ enum: ['direct', 'hub'] }) @IsIn(['direct', 'hub']) quotedRouteMode!: 'direct' | 'hub';
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(1000000) quotedDistanceKm!: number;
}

class DeliveryQuoteLineDto {
  @IsMongoId() productId!: string;
  @IsOptional() @IsMongoId() offerId?: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) quantity!: number;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,29}$/) unitId?: string;
}

class DeliveryQuoteRequestDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DeliveryQuoteLineDto)
  items!: DeliveryQuoteLineDto[];
  @IsDefined() @ValidateNested() @Type(() => DeliveryPointDto) destination!: DeliveryPointDto;
}

class WebOrderDto {
  @IsOptional() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) cartRevision?: number;
  @ApiProperty() @IsUUID('4') requestId!: string;
  @ApiProperty({ type: [OrderLineDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique((item: OrderLineDto) => [item?.productId, item?.unitId ?? 'unit', item?.offerId].join(':'))
  @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
  @ApiProperty({ type: DeliveryDto, required: false })
  @IsOptional() @ValidateNested() @Type(() => DeliveryDto) delivery?: DeliveryDto;
}

@ApiTags('web')
@Controller('web/delivery-options')
export class WebDeliveryController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  options() {
    return { methods: [], quoteRequired: true };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async quote(@Body() input: DeliveryQuoteRequestDto) {
    const methods = await quoteBasketDelivery(this.connection.db!, input.items, input.destination);
    return { methods };
  }
}

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/orders')
export class WebOrdersController {
  constructor(
    private readonly accounts: MarketplaceAccounts,
    private readonly cart: CartService,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly orderPersistence: OrderPersistenceService,
  ) {}

  @Get()
  async list(@Headers('authorization') authorization: string | undefined, @Query() { page, limit }: CatalogQueryDto) {
    const member = await this.accounts.requireMember(authorization);
    return this.orderPersistence.list(member._id, page, limit);
  }

  @Post()
  async create(@Headers('authorization') authorization: string | undefined, @Body() input: WebOrderDto) {
    const member = await this.accounts.requireMember(authorization);
    let workflowOrderId = 'request:' + input.requestId;
    try {
      const request = input.items.map(({ productId, quantity, unitId, offerId }) => ({
        productId: productId.toLowerCase(), quantity, ...(unitId && unitId !== 'unit' && { unitId }),
        ...(offerId && { offerId: offerId.toLowerCase() }),
      }));
      const requestedDelivery = input.delivery && {
        method: input.delivery.method, dispatchDate: input.delivery.dispatchDate, slot: input.delivery.slot,
        destination: input.delivery.destination, quotedFee: input.delivery.quotedFee,
        quotedRouteMode: input.delivery.quotedRouteMode, quotedDistanceKm: input.delivery.quotedDistanceKm,
      };
      const signature = JSON.stringify(requestedDelivery ? { items: request, delivery: requestedDelivery } : request);
      const fromCart = input.cartRevision != null;
      const orderKey = fromCart ? 'cart:' + input.cartRevision : input.requestId;
      const id = createHash('sha256').update(member.id + ':' + orderKey).digest('hex');
      workflowOrderId = id;
      await this.orderPersistence.recordWorkflowLog({ orderId: id, stage: 'checkout.request.received', status: 'succeeded', actorId: member._id, correlationId: input.requestId, details: { itemCount: request.length, fromCart } });
      const existing = await this.orderPersistence.findExisting(id, signature, member._id);
      if (existing) {
        await this.orderPersistence.recordWorkflowLog({ orderId: id, stage: 'checkout.idempotency.replayed', status: 'succeeded', actorId: member._id, correlationId: input.requestId });
        if (fromCart) await this.cart.clear(member._id, input.cartRevision);
        return existing;
      }
  
      const checkout = fromCart ? await this.cart.checkout(member._id, input.cartRevision!, request) : null;
      await this.orderPersistence.recordWorkflowLog({ orderId: id, stage: 'checkout.cart.validated', status: 'succeeded', actorId: member._id, correlationId: input.requestId, details: { cartRevision: input.cartRevision } });
      const records = await this.products.find({
        _id: { $in: request.map(item => item.productId) }, isActive: true,
      }).select('name saleUnit saleUnits maxOrderQuantity kind masterId').lean();
      const products = new Map(records.map(product => [String(product._id), product]));
      const offers = await producerOffers(this.products.db.db!, [...products.keys()]);
      const masterIds = records.flatMap(product => product.kind === 'variant' && product.masterId ? [product.masterId] : []);
      const parents = masterIds.length ? await this.products.find({ _id: { $in: masterIds }, kind: 'master', isActive: true })
        .select('name saleUnit saleUnits maxOrderQuantity').lean() : [];
      const masters = new Map(parents.map(product => [String(product._id), product]));
      const quantities = new Map<string, number>();
      const familyQuantities = new Map<string, number>();
      const offerQuantities = new Map<string, number>();
      const lines = new Set<string>();
      const items = request.map(({ productId, quantity, unitId, offerId }) => {
        const product = products.get(productId);
        const parent = product?.kind === 'variant' ? masters.get(String(product.masterId)) : undefined;
        if (!product || (product.kind === 'variant' && !parent)) throw new BadRequestException('یکی از محصولات برای سفارش در دسترس نیست.');
        const saleUnits = product.saleUnits?.length ? product.saleUnits : parent?.saleUnits;
        const unit = unitId ? saleUnits?.find(option => option.code === unitId) : undefined;
        if (unitId && !unit) throw new BadRequestException('واحد فروش محصول در دسترس نیست.');
        const unitsPerPack = unit?.quantity ?? 1;
        const baseQuantity = quantity * unitsPerPack;
        const availableOffers = offers.get(productId) ?? [];
        const offer = offerId ? availableOffers.find(item => item.id === offerId) : availableOffers.find(item => item.stock >= 1);
        if (!offer) throw new BadRequestException('عرضهٔ فروشنده در دسترس نیست.');
        const quoted = checkout?.find(line => line.productId === productId && line.offerId === offerId && line.unitId === (unitId ?? 'unit'));
        if (checkout && (!quoted || quoted.price !== Math.round(offer.price * 1_000_000) * unitsPerPack / 1_000_000)) {
          throw new ConflictException('قیمت عرضه تغییر کرده است. سبد خرید را دوباره بررسی کنید.');
        }
        const key = [productId, unitId ?? 'unit', offer.id].join(':');
        if (lines.has(key)) throw new BadRequestException('واحد تکراری برای محصول ارسال شده است.');
        lines.add(key);
        const offeredQuantity = (offerQuantities.get(offer.id) ?? 0) + baseQuantity;
        if (offeredQuantity > offer.stock) throw new BadRequestException('تعداد سفارش از موجودی اعلامی فروشنده بیشتر است.');
        offerQuantities.set(offer.id, offeredQuantity);
        const accumulated = (quantities.get(productId) ?? 0) + baseQuantity;
        const familyId = parent ? String(parent._id) : productId;
        const familyTotal = (familyQuantities.get(familyId) ?? 0) + baseQuantity;
        if (!Number.isSafeInteger(accumulated) || !Number.isSafeInteger(familyTotal)) {
          throw new BadRequestException('تعداد سفارش بیش از حد قابل محاسبه است.');
        }
        if (product.maxOrderQuantity != null && accumulated > product.maxOrderQuantity) {
          throw new BadRequestException(`تعداد «${product.name}» از سقف ${product.maxOrderQuantity} واحد اصلی بیشتر است.`);
        }
        const familyLimit = parent ? parent.maxOrderQuantity : product.kind === 'master' ? product.maxOrderQuantity : null;
        if (familyLimit != null && familyTotal > familyLimit) {
          throw new BadRequestException(`تعداد «${parent?.name ?? product.name}» و گزینه‌های آن از سقف ${familyLimit} واحد اصلی بیشتر است.`);
        }
        quantities.set(productId, accumulated);
        familyQuantities.set(familyId, familyTotal);
        return {
          productId, quantity, baseQuantity, name: product.name, unitId: unitId ?? 'unit',
          unitName: unit?.name ?? offer.unit, unitsPerPack,
          price: { min: offer.price, max: offer.price }, offerId: offer.id, sellerId: offer.sellerId, sellerName: offer.name,
        };
      });
      await this.orderPersistence.recordWorkflowLog({ orderId: id, stage: 'checkout.products.validated', status: 'succeeded', actorId: member._id, correlationId: input.requestId, details: { itemCount: items.length } });
      const shippingOptions = requestedDelivery
        ? await quoteBasketDelivery(this.products.db.db!, request, requestedDelivery.destination) : [];
      const delivery = requestedDelivery ? resolveDelivery(requestedDelivery, shippingOptions) : undefined;
      if (delivery && input.delivery && (
        Math.abs(delivery.fee - input.delivery.quotedFee) > 0.0001 ||
        delivery.routeMode !== input.delivery.quotedRouteMode ||
        Math.abs(delivery.distanceKm - input.delivery.quotedDistanceKm) > 0.11
      )) {
        throw new ConflictException('تعرفه یا مسیر حمل تغییر کرده است؛ گزینه‌های ارسال را دوباره بررسی کنید.');
      }
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
      const saved = await this.orderPersistence.create({
        id, memberId: member._id, signature, items, subtotal, price, total, currency: 'KAR',
        ...(delivery && { delivery: delivery as unknown as Record<string, unknown> }),
        source: { channel: 'web', requestId: input.requestId, ...(fromCart && { cartRevision: input.cartRevision }) },
      });
      await this.orderPersistence.recordWorkflowLog({ orderId: id, stage: 'checkout.order.persisted', status: 'succeeded', actorId: member._id, correlationId: input.requestId, details: { status: saved.status } });
      if (fromCart) {
        await this.cart.clear(member._id, input.cartRevision);
        await this.orderPersistence.recordWorkflowLog({ orderId: id, stage: 'checkout.cart.cleared', status: 'succeeded', actorId: member._id, correlationId: input.requestId });
      }
      return saved;
    } catch (error: any) {
      await this.orderPersistence.recordWorkflowLog({
        orderId: workflowOrderId, stage: 'checkout.failed', status: 'failed',
        actorId: member._id, correlationId: input.requestId,
        error: String(error?.message ?? error),
      }).catch(() => undefined);
      throw error;
    }
  }
}
