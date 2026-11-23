import { Connection, Types } from 'mongoose';

interface OfferEntry {
  memberId: Types.ObjectId;
  offer: { productId: Types.ObjectId; price: number; stock: number; unit: string; harvestDate?: string };
}

interface Producer {
  fullName: string;
  organization?: string;
  city?: string;
}

export async function producerOffers(db: NonNullable<Connection['db']>, productIds: string[]) {
  if (!productIds.length) return new Map<string, PublicOffer[]>();
  const rows = await db.collection<OfferEntry>('web_workspace_entries').find({
    section: 'products', 'offer.productId': { $in: productIds.map(id => new Types.ObjectId(id)) },
  }, { projection: { memberId: 1, offer: 1 } }).sort({ createdAt: -1, _id: -1 }).toArray();
  if (!rows.length) return new Map<string, PublicOffer[]>();

  const members = await db.collection<Producer>('members').find({
    _id: { $in: rows.map(row => row.memberId) }, isActive: { $ne: false }, producerType: { $type: 'string', $ne: '' },
  }, { projection: { fullName: 1, organization: 1, city: 1 } }).toArray();
  const producers = new Map(members.map(member => [String(member._id), member]));
  const grouped = new Map<string, PublicOffer[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const productId = String(row.offer.productId);
    const key = productId + ':' + row.memberId;
    const producer = producers.get(String(row.memberId));
    if (!producer || seen.has(key)) continue;
    seen.add(key);
    const offers = grouped.get(productId) ?? [];
    offers.push({
      id: String(row._id), name: producer.organization || producer.fullName, city: producer.city,
      price: row.offer.price, stock: row.offer.stock, unit: row.offer.unit, harvestDate: row.offer.harvestDate,
    });
    grouped.set(productId, offers);
  }
  for (const offers of grouped.values()) offers.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  return grouped;
}

interface PublicOffer {
  id: string;
  name: string;
  city?: string;
  price: number;
  stock: number;
  unit: string;
  harvestDate?: string;
}
