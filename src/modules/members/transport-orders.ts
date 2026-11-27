import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const transportUrgencies = ['normal', 'special', 'express', 'urgent'] as const;
export const transportCategories = ['intracity', 'intercity', 'interprovincial'] as const;
export const transportZoneIds = ['zone-0', 'zone-1', 'zone-2', 'zone-3', 'zone-4', 'zone-5'] as const;

const trimTransportText = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class TransportStopDto {
  @IsIn(['pickup', 'dropoff']) kind!: 'pickup' | 'dropoff';
  @Transform(trimTransportText) @IsString() @Length(1, 100) label!: string;
  @Transform(trimTransportText) @IsString() @Length(1, 100) province!: string;
  @Transform(trimTransportText) @IsString() @Length(1, 100) city!: string;
  @Transform(trimTransportText) @IsString() @Length(1, 240) address!: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

export class TransportOrderDto {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => TransportStopDto)
  stops!: TransportStopDto[];
  @IsString() @Length(2, 120) goodsType!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(100000) weightKg!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10000) volumeM3!: number;
  @IsIn(transportUrgencies) urgency!: typeof transportUrgencies[number];
  @IsDateString() deadline!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class TransportZoneTariffsDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100000000) baseKar!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) distanceWeight!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1000) billableWeightWeight!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) stopWeight!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10000) densityKgPerM3!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(10) minimumKar!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100000000) refrigeratedBaseKar?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) refrigeratedPerKgKar?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) fragileMultiplier?: number;
  @IsOptional() @IsBoolean() hubEnabled?: boolean;
  @IsOptional() @Transform(({ value }) => value === null ? null : Number(value)) @IsNumber() @Min(-90) @Max(90) hubLatitude?: number | null;
  @IsOptional() @Transform(({ value }) => value === null ? null : Number(value)) @IsNumber() @Min(-180) @Max(180) hubLongitude?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100000000) hubHandlingKar?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) hubPerKgKar?: number;
  @IsOptional() @IsBoolean() hubSupportsRefrigeration?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) hubMaxWeightKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100000) hubMaxVolumeM3?: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) normalMultiplier!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) specialMultiplier!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) expressMultiplier!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) urgentMultiplier!: number;
}
export interface TransportZoneTariffRecord {
  _id: string; baseKar: number; distanceWeight: number; billableWeightWeight: number; stopWeight: number;
  densityKgPerM3: number; minimumKar: number; normalMultiplier: number; specialMultiplier: number;
  expressMultiplier: number; urgentMultiplier: number;
  refrigeratedBaseKar: number; refrigeratedPerKgKar: number; fragileMultiplier: number;
  hubEnabled: boolean; hubLatitude?: number | null; hubLongitude?: number | null; hubHandlingKar: number; hubPerKgKar: number;
  hubSupportsRefrigeration: boolean; hubMaxWeightKg: number; hubMaxVolumeM3: number;
  createdAt?: Date; updatedAt?: Date;
}
export const zoneDefinitions = [
  { id: 'zone-0', label: 'زون ۰', minKm: 0, maxKm: 10 },
  { id: 'zone-1', label: 'زون ۱', minKm: 10, maxKm: 20 },
  { id: 'zone-2', label: 'زون ۲', minKm: 20, maxKm: 50 },
  { id: 'zone-3', label: 'زون ۳', minKm: 50, maxKm: 200 },
  { id: 'zone-4', label: 'زون ۴', minKm: 200, maxKm: 500 },
  { id: 'zone-5', label: 'زون ۵', minKm: 500, maxKm: null },
] as const;
export const speedDefinitions = [
  { id: 'normal', label: 'اقتصادی', target: 'حدود ۵ روز' },
  { id: 'special', label: 'عادی', target: 'حدود ۳ روز' },
  { id: 'express', label: 'سریع', target: 'تا فردا' },
  { id: 'urgent', label: 'فوری', target: 'همان روز، در صورت وجود بازه' },
] as const;
export const defaultTransportZoneTariffs: TransportZoneTariffRecord = {
  _id: 'default', baseKar: 2, distanceWeight: 0.02, billableWeightWeight: 0.001,
  stopWeight: 0.1, densityKgPerM3: 250, minimumKar: 2,
  normalMultiplier: 1, specialMultiplier: 1.35, expressMultiplier: 1.8, urgentMultiplier: 2.5,
  refrigeratedBaseKar: 0, refrigeratedPerKgKar: 0, fragileMultiplier: 1.15,
  hubEnabled: false, hubLatitude: null, hubLongitude: null, hubHandlingKar: 0, hubPerKgKar: 0,
  hubSupportsRefrigeration: false, hubMaxWeightKg: 0, hubMaxVolumeM3: 0,
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('fa-IR').replace(/^(?:استان|شهرستان|شهر)\\s+/, '').replace(/\\s+/g, ' ');
}
export function classifyTransportRoute(stops: TransportStopDto[]) {
  const provinces = new Set(stops.map(stop => normalize(stop.province)));
  const cities = new Set(stops.map(stop => normalize(stop.city)));
  if (provinces.size > 1) return 'interprovincial' as const;
  if (cities.size > 1) return 'intercity' as const;
  return 'intracity' as const;
}
function haversine(a: TransportStopDto, b: TransportStopDto) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function zoneForDistance(distanceKm: number) {
  return zoneDefinitions.find(zone => distanceKm >= zone.minKm && (zone.maxKm === null || distanceKm < zone.maxKm || (zone.id === 'zone-4' && distanceKm <= zone.maxKm))) ?? zoneDefinitions[5];
}
const routeCache = new Map<string, { promise: Promise<number | null>; expiresAt: number }>();

async function roadLegKm(a: TransportStopDto, b: TransportStopDto): Promise<number | null> {
  const key = [a.latitude, a.longitude, b.latitude, b.longitude].join(',');
  const cached = routeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const base = process.env.ROUTING_SERVICE_URL?.replace(/\/$/, '') || 'https://router.project-osrm.org';
  const promise = (async () => {
    try {
      const response = await fetch(base + '/route/v1/driving/' + a.longitude + ',' + a.latitude + ';' + b.longitude + ',' + b.latitude + '?overview=false&alternatives=false&steps=false', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const data = await response.json() as { routes?: Array<{ distance?: number }> };
      const meters = data.routes?.[0]?.distance;
      return typeof meters === 'number' && Number.isFinite(meters) && meters >= 0 ? meters / 1000 : null;
    } catch { return null; }
  })();
  const entry = { promise, expiresAt: Date.now() + 5000 };
  routeCache.set(key, entry);
  void promise.then(value => { entry.expiresAt = Date.now() + (value === null ? 10000 : 60000); });
  if (routeCache.size > 2000) routeCache.delete(routeCache.keys().next().value!);
  return promise;
}
export async function quoteTransportOrder(stops: TransportStopDto[], weightKg: number, volumeM3: number, urgency: string, tariffs: TransportZoneTariffRecord) {
  const directDistanceKm = stops.slice(1).reduce((sum, stop, index) => sum + haversine(stops[index], stop), 0);
  const legs = await Promise.all(stops.slice(1).map((stop, index) => roadLegKm(stops[index], stop)));
  const hasRoadDistance = legs.every(value => value !== null);
  const roadDistanceKm = hasRoadDistance ? (legs as number[]).reduce((sum, value) => sum + value, 0) : null;
  const billableWeightKg = Math.max(weightKg, volumeM3 * tariffs.densityKgPerM3);
  const distanceKm = roadDistanceKm ?? directDistanceKm;
  const zone = zoneForDistance(distanceKm);
  const speed = speedDefinitions.some(item => item.id === urgency) ? urgency as typeof transportUrgencies[number] : 'normal';
  const speedMultiplier = ({
    normal: tariffs.normalMultiplier, special: tariffs.specialMultiplier,
    express: tariffs.expressMultiplier, urgent: tariffs.urgentMultiplier,
  })[speed];
  const stopCount = Math.max(0, stops.length - 2);
  const raw = tariffs.baseKar + distanceKm * tariffs.distanceWeight +
    billableWeightKg * tariffs.billableWeightWeight + stopCount * tariffs.stopWeight;
  const standardKar = Math.max(tariffs.minimumKar, Math.round(raw * speedMultiplier * 10000) / 10000);
  return {
    category: classifyTransportRoute(stops), zoneId: zone.id, speed, distanceKm: Math.round(distanceKm * 10) / 10,
    directDistanceKm: Math.round(directDistanceKm * 10) / 10, roadDistanceKm: roadDistanceKm === null ? null : Math.round(roadDistanceKm * 10) / 10,
    distanceSource: hasRoadDistance ? 'road' as const : 'direct_estimate' as const,
    billableWeightKg: Math.round(billableWeightKg * 100) / 100, standardKar,
    specialKar: Math.round(standardKar * 1.5 * 10000) / 10000, currency: 'KAR' as const,
    routingPending: !hasRoadDistance,
  };
}
export async function findEligibleTransportCarriers(db: import('mongodb').Db, weightKg: number, volumeM3: number, stops: TransportStopDto[], densityKgPerM3 = 250) {
  const members = await db.collection('members').find({
    serviceTypes: 'driver', 'driverReview.status': 'approved', isActive: { $ne: false },
  }, { projection: { fullName: 1, phone: 1, organization: 1, city: 1, province: 1, serviceArea: 1 } }).toArray();
  if (!members.length) return [];
  const vehicles = await db.collection('member_vehicles').find({
    memberId: { $in: members.map(member => member._id) }, capacityKg: { $gte: Math.max(weightKg, volumeM3 * densityKgPerM3) },
    $or: [{ capacityM3: { $gte: volumeM3 } }, { capacityM3: { $exists: false } }],
  }, { projection: { memberId: 1, type: 1, model: 1, capacityKg: 1, capacityM3: 1, plate: 1 } }).toArray();
  const routeText = normalize(stops.map(stop => stop.city + ' ' + stop.province).join(' '));
  const memberMap = new Map(members.map(member => [String(member._id), member]));
  const candidates = new Map<string, { memberId: string; fullName: string; phone?: string; city?: string; vehicleType: string; model: string; capacityKg: number; capacityM3?: number }>();
  for (const vehicle of vehicles) {
    const member = memberMap.get(String(vehicle.memberId));
    if (!member) continue;
    const area = typeof member.serviceArea === 'string' ? normalize(member.serviceArea) : '';
    const areaTokens = area.split(/[،,؛;\\s]+/).filter(part => part.length > 2 && !['استان', 'شهرستان', 'شهر'].includes(part));
    const nationwide = /کل کشور|سراسری|ایران|همه|تمام/.test(area);
    if (area && !nationwide && !routeText.includes(area) && areaTokens.length && !areaTokens.some(part => routeText.includes(part))) continue;
    const memberId = String(member._id);
    const candidate = { memberId, fullName: member.fullName || member.organization || 'همکار حمل', phone: member.phone, city: member.city,
      vehicleType: vehicle.type, model: vehicle.model, capacityKg: vehicle.capacityKg, ...(vehicle.capacityM3 != null && { capacityM3: vehicle.capacityM3 }) };
    const previous = candidates.get(memberId);
    if (!previous || candidate.capacityKg < previous.capacityKg) candidates.set(memberId, candidate);
  }
  return [...candidates.values()];
}
