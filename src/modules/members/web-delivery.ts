import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { producerOffers } from '../catalog/producer-offers';
import { defaultTransportZoneTariffs, quoteTransportOrder, type TransportStopDto, type TransportZoneTariffRecord } from './transport-orders';

export const deliveryMethods = ['economy', 'standard', 'express', 'urgent'] as const;
export const deliverySlots = [
  { id: 'morning', label: '۹ تا ۱۲' },
  { id: 'afternoon', label: '۱۲ تا ۱۵' },
  { id: 'evening', label: '۱۵ تا ۱۸' },
] as const;

const policies = [
  { id: 'economy', label: 'ارسال اقتصادی', lead: 4, speed: 'normal' },
  { id: 'standard', label: 'ارسال عادی', lead: 2, speed: 'special' },
  { id: 'express', label: 'ارسال سریع', lead: 1, speed: 'express' },
  { id: 'urgent', label: 'ارسال فوری', lead: 0, speed: 'urgent' },
] as const;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
});

export type BasketShippingLine = { productId: string; offerId?: string; quantity: number; unitId?: string };
export type DeliveryPoint = { latitude: number; longitude: number };
export type BasketDeliveryQuote = {
  id: typeof deliveryMethods[number];
  label: string;
  fee: number;
  windows: Array<{ dispatchDate: string; deliveryDate: string }>;
  slots: typeof deliverySlots;
  routeMode: 'direct' | 'hub';
  distanceKm: number;
  routingPending: boolean;
  refrigerated: boolean;
  fragile: boolean;
  breakdown: { transportKar: number; coldChainKar: number; handlingKar: number };
  routeLabel: string;
};

function dayAt(start: Date, offset: number) {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function stop(kind: 'pickup' | 'dropoff', label: string, point: DeliveryPoint): TransportStopDto {
  return {
    kind, label, province: 'نامشخص', city: 'نامشخص', address: label,
    latitude: point.latitude, longitude: point.longitude,
  };
}

function roundKar(value: number) {
  return Math.round(value * 10000) / 10000;
}

export async function quoteBasketDelivery(
  db: import('mongodb').Db,
  lines: BasketShippingLine[],
  destination: DeliveryPoint,
  now = new Date(),
): Promise<BasketDeliveryQuote[]> {
  if (!lines.length || lines.length > 50) throw new BadRequestException('اقلام سبد برای محاسبه حمل معتبر نیستند.');
  if (!Number.isFinite(destination.latitude) || Math.abs(destination.latitude) > 90 ||
      !Number.isFinite(destination.longitude) || Math.abs(destination.longitude) > 180) {
    throw new BadRequestException('موقعیت مقصد برای محاسبه هزینه حمل معتبر نیست.');
  }

  const ids = [...new Set(lines.map(line => line.productId.toLowerCase()))];
  if (lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1)) {
    throw new BadRequestException('تعداد اقلام برای محاسبه حمل معتبر نیست.');
  }
  const [products, offers, storedTariffs] = await Promise.all([
    db.collection('products').find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) }, isActive: true },
      { projection: { name: 1, kind: 1, masterId: 1, saleUnits: 1, physical: 1 } }).toArray(),
    producerOffers(db, ids),
    db.collection<TransportZoneTariffRecord>('transport_zone_tariffs').findOne({ _id: 'default' }),
  ]);
  const tariffs = { ...defaultTransportZoneTariffs, ...(storedTariffs ?? {}) };
  const productMap = new Map(products.map(product => [String(product._id), product]));
  const parentIds = products.flatMap(product => product.kind === 'variant' && product.masterId ? [product.masterId] : []);
  const parents = parentIds.length ? await db.collection('products').find({
    _id: { $in: parentIds }, kind: 'master', isActive: true,
  }, { projection: { name: 1, saleUnits: 1, physical: 1 } }).toArray() : [];
  const parentMap = new Map(parents.map(product => [String(product._id), product]));

  type PickupGroup = { point: DeliveryPoint; label: string; weightKg: number; volumeM3: number; refrigerated: boolean; fragile: boolean };
  const groups = new Map<string, PickupGroup>();
  let refrigerated = false;
  let fragile = false;
  let totalWeightKg = 0;
  let totalVolumeM3 = 0;
  let coldWeightKg = 0;

  for (const line of lines) {
    const product = productMap.get(line.productId.toLowerCase());
    const parent = product?.kind === 'variant' && product.masterId ? parentMap.get(String(product.masterId)) : undefined;
    if (!product || (product.kind === 'variant' && !parent)) {
      throw new BadRequestException('یکی از محصولات سبد برای محاسبه حمل در دسترس نیست.');
    }
    const sellerOffers = offers.get(line.productId.toLowerCase()) ?? [];
    const offer = line.offerId ? sellerOffers.find(item => item.id === line.offerId) : sellerOffers.find(item => item.stock >= line.quantity);
    if (!offer || !offer.pickupLocation ||
        !Number.isFinite(offer.pickupLocation.latitude) || !Number.isFinite(offer.pickupLocation.longitude)) {
      throw new BadRequestException('برای یکی از عرضه‌کنندگان، موقعیت بارگیری روی نقشه ثبت نشده است.');
    }
    const physical = product.physical ?? parent?.physical;
    const units = (product.saleUnits?.length ? product.saleUnits : parent?.saleUnits) ?? [];
    const unit = line.unitId ? units.find(item => item.code === line.unitId) : undefined;
    if (line.unitId && !unit) throw new BadRequestException('واحد فروش یکی از محصولات معتبر نیست.');
    const baseQuantity = line.quantity * (unit?.quantity ?? 1);
    const dimensions = physical?.shippingDimensions;
    const unitVolume = dimensions
      ? dimensions.lengthMm * dimensions.widthMm * dimensions.heightMm / 1_000_000_000
      : undefined;
    const unitWeight = typeof physical?.shippingWeightG === 'number' ? physical.shippingWeightG / 1000 : undefined;
    if (unitVolume === undefined && unitWeight === undefined) {
      throw new BadRequestException('وزن یا ابعاد حمل یکی از محصولات در مشخصات فیزیکی کاتالوگ ثبت نشده است.');
    }
    const density = physical?.standardDensityKgM3 ?? tariffs.densityKgPerM3;
    const volumeM3 = (unitVolume ?? (unitWeight! / density)) * baseQuantity;
    const weightKg = (unitWeight ?? (unitVolume! * density)) * baseQuantity;
    const cold = Boolean(physical?.requiresRefrigeration);
    const isFragile = Boolean(physical?.fragile);
    refrigerated ||= cold;
    fragile ||= isFragile;
    if (cold) coldWeightKg += Math.max(weightKg, volumeM3 * tariffs.densityKgPerM3);
    totalWeightKg += weightKg;
    totalVolumeM3 += volumeM3;

    const location = offer.pickupLocation;
    const key = location.id;
    const current = groups.get(key) ?? {
      point: { latitude: location.latitude!, longitude: location.longitude! },
      label: location.title || offer.name, weightKg: 0, volumeM3: 0, refrigerated: false, fragile: false,
    };
    current.weightKg += weightKg;
    current.volumeM3 += volumeM3;
    current.refrigerated ||= cold;
    current.fragile ||= isFragile;
    groups.set(key, current);
  }

  const pickups = [...groups.values()];
  const destinationStop = stop('dropoff', 'مقصد مشتری', destination);
  const hubReady = tariffs.hubEnabled && Number.isFinite(tariffs.hubLatitude) &&
    Number.isFinite(tariffs.hubLongitude);
  const hub = hubReady ? { latitude: tariffs.hubLatitude!, longitude: tariffs.hubLongitude! } : null;
  const today = dateFormatter.format(now);
  const start = new Date(today + 'T12:00:00Z');

  const results = await Promise.all(policies.map(async policy => {
    let directTransport = 0;
    let directDistance = 0;
    let directRoutingPending = false;
    for (const pickup of pickups) {
      const quote = await quoteTransportOrder(
        [stop('pickup', pickup.label, pickup.point), destinationStop],
        pickup.weightKg, pickup.volumeM3, policy.speed, tariffs,
      );
      directTransport += quote.standardKar;
      directDistance += quote.distanceKm;
      directRoutingPending ||= quote.routingPending;
    }

    let selectedTransport = directTransport;
    let selectedDistance = directDistance;
    let routingPending = directRoutingPending;
    let routeMode: 'direct' | 'hub' = 'direct';
    let handlingKar = 0;
    if (hub) {
      let hubTransport = 0;
      let hubDistance = 0;
      let hubRoutingPending = false;
      for (const pickup of pickups) {
        const quote = await quoteTransportOrder(
          [stop('pickup', pickup.label, pickup.point), stop('dropoff', 'مرکز تجمیع ساری‌چین', hub)],
          pickup.weightKg, pickup.volumeM3, policy.speed, tariffs,
        );
        hubTransport += quote.standardKar;
        hubDistance += quote.distanceKm;
        hubRoutingPending ||= quote.routingPending;
      }
      const finalLeg = await quoteTransportOrder(
        [stop('pickup', 'مرکز تجمیع ساری‌چین', hub), destinationStop],
        totalWeightKg, totalVolumeM3, policy.speed, tariffs,
      );
      hubTransport += finalLeg.standardKar;
      hubDistance += finalLeg.distanceKm;
      hubRoutingPending ||= finalLeg.routingPending;
      const hubHandling = tariffs.hubHandlingKar + totalWeightKg * tariffs.hubPerKgKar;
      if (hubTransport + hubHandling < directTransport) {
        selectedTransport = hubTransport;
        selectedDistance = hubDistance;
        routingPending = hubRoutingPending;
        routeMode = 'hub';
        handlingKar = hubHandling;
      }
    }

    const speedMultiplier = policy.speed === 'normal' ? tariffs.normalMultiplier
      : policy.speed === 'special' ? tariffs.specialMultiplier
      : policy.speed === 'express' ? tariffs.expressMultiplier : tariffs.urgentMultiplier;
    const coldChainKar = refrigerated ? tariffs.refrigeratedBaseKar + coldWeightKg * tariffs.refrigeratedPerKgKar : 0;
    const adjustedTransport = selectedTransport * (fragile ? tariffs.fragileMultiplier : 1);
    const fee = roundKar(adjustedTransport + coldChainKar + handlingKar);
    const windows = Array.from({ length: 7 }, (_, index) => ({
      dispatchDate: dayAt(start, index + 1),
      deliveryDate: dayAt(start, index + 1 + policy.lead),
    }));
    return {
      id: policy.id, label: policy.label, fee, windows, slots: deliverySlots,
      routeMode, distanceKm: Math.round(selectedDistance * 10) / 10, routingPending,
      refrigerated, fragile,
      breakdown: { transportKar: roundKar(adjustedTransport), coldChainKar: roundKar(coldChainKar), handlingKar: roundKar(handlingKar) },
      routeLabel: routeMode === 'hub' ? 'تجمیع در مرکز ساری‌چین' : 'ارسال مستقیم از تولیدکنندگان',
    };
  }));
  return results;
}

export function deliveryOptions(now = new Date()) {
  const today = dateFormatter.format(now);
  const start = new Date(today + 'T12:00:00Z');
  return policies.map(policy => ({
    id: policy.id, label: policy.label,
    windows: Array.from({ length: 7 }, (_, index) => ({
      dispatchDate: dayAt(start, index + 1),
      deliveryDate: dayAt(start, index + 1 + policy.lead),
    })),
    slots: deliverySlots, fee: 0,
  }));
}

export function resolveDelivery(
  input: { method: string; dispatchDate: string; slot: string },
  options = deliveryOptions(),
) {
  const method = options.find(option => option.id === input.method);
  const slot = deliverySlots.find(option => option.id === input.slot);
  const window = method?.windows.find(option => option.dispatchDate === input.dispatchDate);
  if (!method || !slot || !window || !Number.isFinite(method.fee) || method.fee < 0) {
    throw new BadRequestException('روش یا زمان ارسال معتبر نیست. گزینه‌های ارسال را دوباره بررسی کنید.');
  }
  return { ...input, date: window.deliveryDate, label: method.label, slotLabel: slot.label, fee: method.fee };
}
