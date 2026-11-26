import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const transportUrgencies = ['hourly', 'daily', 'multiday'] as const;
export const transportCategories = ['intracity', 'intercity', 'interprovincial'] as const;

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

export class TransportTariffDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) intracityBaseKar!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) intercityBaseKar!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) interprovincialBaseKar!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) perKmKar!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1000) perKgKar!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000) perCubicMeterKar!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) hourlyMultiplier!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) dailyMultiplier!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.1) @Max(10) multidayMultiplier!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(1) @Max(5) specialMultiplier!: number;
}

export interface TransportTariffRecord {
  _id: string;
  intracityBaseKar: number;
  intercityBaseKar: number;
  interprovincialBaseKar: number;
  perKmKar: number;
  perKgKar: number;
  perCubicMeterKar: number;
  hourlyMultiplier: number;
  dailyMultiplier: number;
  multidayMultiplier: number;
  specialMultiplier: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const defaultTransportTariffs: TransportTariffRecord = {
  _id: 'default',
  intracityBaseKar: 2,
  intercityBaseKar: 2,
  interprovincialBaseKar: 2,
  perKmKar: 0,
  perKgKar: 0,
  perCubicMeterKar: 0,
  hourlyMultiplier: 1,
  dailyMultiplier: 1,
  multidayMultiplier: 1,
  specialMultiplier: 1.5,
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('fa-IR').replace(/^(?:استان|شهرستان|شهر)\s+/, '').replace(/\s+/g, ' ');
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
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function quoteTransportOrder(stops: TransportStopDto[], weightKg: number, volumeM3: number, urgency: string, tariffs: TransportTariffRecord) {
  const category = classifyTransportRoute(stops);
  const distanceKm = stops.slice(1).reduce((total, stop, index) => total + haversine(stops[index], stop), 0);
  const base = category === 'intracity' ? tariffs.intracityBaseKar
    : category === 'intercity' ? tariffs.intercityBaseKar : tariffs.interprovincialBaseKar;
  const multiplier = urgency === 'hourly' ? tariffs.hourlyMultiplier : urgency === 'daily' ? tariffs.dailyMultiplier : tariffs.multidayMultiplier;
  const standardKar = Math.round((base + distanceKm * tariffs.perKmKar + weightKg * tariffs.perKgKar + volumeM3 * tariffs.perCubicMeterKar) * multiplier * 10000) / 10000;
  const specialKar = Math.round(standardKar * tariffs.specialMultiplier * 10000) / 10000;
  return { category, distanceKm: Math.round(distanceKm * 10) / 10, standardKar, specialKar, currency: 'KAR' as const };
}

export async function findEligibleTransportCarriers(db: import('mongodb').Db, weightKg: number, volumeM3: number, stops: TransportStopDto[]) {
  const members = await db.collection('members').find({
    serviceTypes: 'driver', 'driverReview.status': 'approved', isActive: { $ne: false },
  }, { projection: { fullName: 1, phone: 1, organization: 1, city: 1, province: 1, serviceArea: 1 } }).toArray();
  if (!members.length) return [];
  const vehicles = await db.collection('member_vehicles').find({
    memberId: { $in: members.map(member => member._id) }, capacityKg: { $gte: weightKg },
    $or: [{ capacityM3: { $gte: volumeM3 } }, { capacityM3: { $exists: false } }],
  }, { projection: { memberId: 1, type: 1, model: 1, capacityKg: 1, capacityM3: 1, plate: 1 } }).toArray();
  const routeText = normalize(stops.map(stop => stop.city + ' ' + stop.province).join(' '));
  const memberMap = new Map(members.map(member => [String(member._id), member]));
  const candidates = new Map<string, {
    memberId: string; fullName: string; phone?: string; city?: string;
    vehicleType: string; model: string; capacityKg: number; capacityM3?: number;
  }>();
  for (const vehicle of vehicles) {
    const member = memberMap.get(String(vehicle.memberId));
    if (!member) continue;
    const area = typeof member.serviceArea === 'string' ? normalize(member.serviceArea) : '';
    const areaTokens = area.split(/[،,؛;\s]+/).filter(part => part.length > 2 && !['استان', 'شهرستان', 'شهر'].includes(part));
    const nationwide = /کل کشور|سراسری|ایران|همه|تمام/.test(area);
    if (area && !nationwide && !routeText.includes(area) && areaTokens.length && !areaTokens.some(part => routeText.includes(part))) continue;
    const memberId = String(member._id);
    const candidate = {
      memberId, fullName: member.fullName || member.organization || 'همکار حمل',
      phone: member.phone, city: member.city, vehicleType: vehicle.type, model: vehicle.model,
      capacityKg: vehicle.capacityKg, ...(vehicle.capacityM3 != null && { capacityM3: vehicle.capacityM3 }),
    };
    const previous = candidates.get(memberId);
    if (!previous || candidate.capacityKg < previous.capacityKg) candidates.set(memberId, candidate);
  }
  return [...candidates.values()];
}
