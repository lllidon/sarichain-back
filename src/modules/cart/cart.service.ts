import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Connection, Types } from 'mongoose';
import { CartCatalog, Quote } from './cart-catalog';
import { CartMutation, CartSelection, cartLineLimit, MergeCart } from './cart.dto';

interface Notice {
  id: string;
  previousPrice: number | null;
  price: number | null;
  unavailable: boolean;
}

interface Line extends CartSelection {
  key: string;
  quantity: number;
  unitId: string;
  sellerId?: string;
  name: string;
  sellerName?: string;
  unitName: string;
  stock: number;
  amount: number;
  price: number | null;
  available: boolean;
  notice?: Notice;
}

interface AccountCart {
  _id: Types.ObjectId;
  revision: number;
  items: Line[];
}

type Quotes = Awaited<ReturnType<CartCatalog['load']>>;

@Injectable()
export class CartService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly catalog: CartCatalog) {}

  private get carts() {
    return this.connection.db!.collection<AccountCart>('web_carts');
  }

  async read(memberId: Types.ObjectId) {
    return this.update(memberId, [], items => items);
  }

  async mutate(memberId: Types.ObjectId, input: CartMutation) {
    return this.update(memberId, [input.productId], (items, quotes) => {
      const selected = input.key ? items.find(line => line.key === input.key) : undefined;
      if (input.key && !selected) {
        if (input.operation === 'set' && input.quantity === 0) return items;
        throw new ConflictException('سبد خرید تغییر کرده است.');
      }
      const selection = selected ?? this.normalize(input);
      const quote = quotes(selection);
      const line = selected ?? this.match(items, selection, quote);
      const current = line?.quantity ?? 0;
      const quantity = input.operation === 'add' ? current + 1 : input.operation === 'reduce' ? Math.max(0, current - 1) : input.quantity;
      if (quantity === undefined || !Number.isSafeInteger(quantity)) throw new BadRequestException('تعداد معتبر نیست.');
      if (quantity > current) this.assertQuantity(items, quotes, line, quote, quantity);
      if (line) return items.flatMap(item => item.key !== line.key ? [item] : quantity ? [{ ...item, quantity }] : []);
      return quantity ? [...items, this.makeLine(selection, quote, quantity)] : items;
    });
  }

  async merge(memberId: Types.ObjectId, input: MergeCart) {
    return this.update(memberId, input.items.map(item => item.productId), (items, quotes) => {
      for (const guest of input.items) {
        const selection = this.normalize(guest);
        const quote = quotes(selection);
        const current = this.match(items, selection, quote);
        // Prefer the account's quantity when this selection is already present.
        if (current) continue;
        if (items.length >= cartLineLimit) throw new BadRequestException('برای انتقال سبد مهمان، ظرفیت سبد حساب را آزاد کنید.');
        items = [...items, this.makeLine(selection, quote, guest.quantity)];
      }
      return items;
    });
  }

  async acknowledge(memberId: Types.ObjectId, ids: string[]) {
    const reviewed = new Set(ids);
    return this.update(memberId, [], items => items.map(item =>
      item.notice && reviewed.has(item.notice.id) ? { ...item, notice: undefined } : item));
  }

  async clear(memberId: Types.ObjectId, revision?: number) {
    if (revision === undefined) return this.update(memberId, [], () => []);
    // An order retry must never remove items added since that order was placed.
    await this.carts.updateOne({ _id: memberId, revision }, { $set: { items: [] }, $inc: { revision: 1 } });
  }

  async checkout(memberId: Types.ObjectId, revision: number, selections: Array<CartSelection & { quantity: number }>) {
    const cart = await this.read(memberId);
    const signature = (items: typeof selections) => items.map(item =>
      [item.productId, item.unitId ?? 'unit', item.offerId, item.quantity].join(':')).sort().join('|');
    if (cart.revision !== revision || cart.items.some(item => !item.available || item.notice) ||
        signature(cart.items) !== signature(selections)) {
      throw new ConflictException('سبد خرید تغییر کرده است. قیمت و موجودی را دوباره بررسی کنید.');
    }
    return cart.items;
  }

  private normalize(input: CartSelection): CartSelection & { unitId: string } {
    return { productId: input.productId.toLowerCase(), unitId: input.unitId ?? 'unit', offerId: input.offerId?.toLowerCase() };
  }

  private match(items: Line[], selection: CartSelection, quote: Quote) {
    return items.find(item => item.productId === selection.productId && item.unitId === selection.unitId &&
      (quote.sellerId ? item.sellerId === quote.sellerId : item.offerId === selection.offerId));
  }

  private makeLine(selection: CartSelection & { unitId: string }, quote: Quote, quantity: number): Line {
    return {
      ...selection, key: randomUUID(), offerId: quote.offerId, sellerId: quote.sellerId,
      quantity, price: quote.price, available: quote.price !== null && quantity * quote.amount <= quote.stock,
      name: quote.name, sellerName: quote.sellerName, unitName: quote.unitName, stock: quote.stock, amount: quote.amount,
    };
  }

  private assertQuantity(items: Line[], quotes: Quotes, line: Line | undefined, quote: Quote, quantity: number) {
    if ((!line && items.length >= cartLineLimit) || quote.price === null) throw new BadRequestException('این عرضه قابل افزودن نیست.');
    const base = quantity * quote.amount;
    let stock = base, sku = base, family = base;
    for (const other of items) {
      if (other.key === line?.key) continue;
      const otherQuote = quotes(other);
      if (otherQuote.price === null) continue;
      const amount = other.quantity * otherQuote.amount;
      if (otherQuote.family === quote.family) family += amount;
      if (other.productId !== quote.productId) continue;
      sku += amount;
      if (otherQuote.sellerId === quote.sellerId) stock += amount;
    }
    if (!Number.isSafeInteger(family) || stock > quote.stock || sku > quote.skuLimit || family > quote.familyLimit) {
      throw new BadRequestException('تعداد از موجودی یا سقف خرید بیشتر است.');
    }
  }

  private refresh(items: Line[], quotes: Quotes): Line[] {
    const totals = new Map<string, number>();
    for (const line of items) {
      const quote = quotes(line);
      if (quote.price === null || !quote.offerId) continue;
      totals.set(quote.offerId, (totals.get(quote.offerId) ?? 0) + line.quantity * quote.amount);
    }
    return items.map(line => {
      const quote = quotes(line);
      const available = quote.price !== null && !!quote.offerId && (totals.get(quote.offerId) ?? 0) <= quote.stock;
      const priceChanged = quote.price !== null && line.price !== null && line.price !== quote.price;
      const becameUnavailable = line.available && !available;
      const pendingChanged = line.notice && (line.notice.unavailable === available || (quote.price !== null && line.notice.price !== quote.price));
      const notice = priceChanged || becameUnavailable || pendingChanged ? {
        id: randomUUID(), previousPrice: line.notice ? line.notice.previousPrice : line.price,
        price: quote.price, unavailable: !available,
      } : line.notice;
      return {
        ...line, offerId: quote.offerId, sellerId: quote.sellerId, name: quote.name, unitName: quote.unitName,
        sellerName: quote.sellerName ?? line.sellerName, stock: quote.stock, amount: quote.amount,
        price: quote.price ?? line.price, available, ...(notice && { notice }),
      };
    });
  }

  private async update(memberId: Types.ObjectId, additional: string[], apply: (items: Line[], quotes: Quotes) => Line[]) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await this.carts.findOne({ _id: memberId });
      const cart = existing ?? { _id: memberId, revision: 0, items: [] };
      const quotes = await this.catalog.load([...additional.map(id => id.toLowerCase()), ...cart.items.map(item => item.productId)]);
      const current = this.refresh(cart.items, quotes);
      const items = this.refresh(apply(current, quotes), quotes);
      if (JSON.stringify(items) === JSON.stringify(cart.items)) return this.view(cart);
      const revision = cart.revision + 1;
      // Strip undefined optional fields so MongoDB does not store null in their place.
      const next = JSON.parse(JSON.stringify(items)) as Line[];
      if (!existing) {
        const created = await this.carts.updateOne({ _id: memberId }, { $setOnInsert: { revision, items: next } }, { upsert: true });
        if (created.upsertedCount) return this.view({ ...cart, revision, items: next });
      } else {
        const saved = await this.carts.updateOne({ _id: memberId, revision: cart.revision }, { $set: { revision, items: next } });
        if (saved.modifiedCount) return this.view({ ...cart, revision, items: next });
      }
    }
    throw new ConflictException('سبد هم‌زمان تغییر کرد. دوباره تلاش کنید.');
  }

  private view(cart: AccountCart) {
    return {
      revision: cart.revision,
      items: cart.items.map(({ sellerId, ...item }) => item),
    };
  }
}
