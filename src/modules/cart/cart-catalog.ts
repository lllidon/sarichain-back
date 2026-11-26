import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { producerOffers } from '../catalog/producer-offers';
import { Product } from '../products/schemas/product.schema';
import { CartSelection } from './cart.dto';

export interface Quote {
  productId: string;
  offerId?: string;
  sellerId?: string;
  sellerName?: string;
  name: string;
  unitName: string;
  price: number | null;
  amount: number;
  stock: number;
  family: string;
  skuLimit: number;
  familyLimit: number;
}

@Injectable()
export class CartCatalog {
  constructor(@InjectModel(Product.name) private readonly products: Model<Product>) {}

  async load(ids: string[]) {
    const keys = [...new Set(ids)];
    const fields = 'name kind masterId saleUnit saleUnits maxOrderQuantity isActive';
    const [items, offers] = await Promise.all([
      this.products.find({ _id: { $in: keys } }).select(fields).lean(),
      producerOffers(this.products.db.db!, keys),
    ]);
    const parents = await this.products.find({
      _id: { $in: items.flatMap(item => item.masterId ? [item.masterId] : []) }, kind: 'master',
    }).select(fields).lean();
    const byId = new Map(items.map(item => [String(item._id), item]));
    const byParent = new Map(parents.map(item => [String(item._id), item]));
    return (line: CartSelection & { sellerId?: string; name?: string; unitName?: string }): Quote => {
      const product = byId.get(line.productId);
      const parent = product?.masterId ? byParent.get(String(product.masterId)) : undefined;
      const candidates = offers.get(line.productId) ?? [];
      const offer = line.sellerId ? candidates.find(item => item.sellerId === line.sellerId)
        : line.offerId ? candidates.find(item => item.id === line.offerId) : candidates.find(item => item.stock >= 1);
      const unitId = line.unitId ?? 'unit';
      const units = product?.saleUnits?.length ? product.saleUnits : parent?.saleUnits;
      const pack = units?.find(unit => unit.code === unitId);
      const active = product?.isActive && (product.kind !== 'variant' || parent?.isActive) && (unitId === 'unit' || pack);
      const amount = pack?.quantity ?? 1;
      return {
        productId: line.productId, offerId: offer?.id ?? line.offerId, sellerId: offer?.sellerId ?? line.sellerId,
        sellerName: offer?.name,
        name: product?.name ?? line.name ?? 'محصول ناموجود',
        unitName: pack?.name ?? offer?.unit ?? line.unitName ?? 'واحد',
        price: active && offer ? Math.round(offer.price * 1_000_000) * amount / 1_000_000 : null,
        amount, stock: active ? offer?.stock ?? 0 : 0, family: parent ? String(parent._id) : line.productId,
        skuLimit: product?.maxOrderQuantity ?? Number.MAX_SAFE_INTEGER,
        familyLimit: (parent ?? product)?.maxOrderQuantity ?? Number.MAX_SAFE_INTEGER,
      };
    };
  }
}
