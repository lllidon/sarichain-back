import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongoError, isObjectIdOrHexString, Model } from 'mongoose';
import { verifyPassword } from '../auth/password';
import { LocationsService } from '../locations/locations.service';
import { MarketplaceLoginDto, MarketplaceProfileDto } from './marketplace.dto';
import { MarketplaceMember } from './member.schemas';
import { needsSpecialistReview } from './member-types';

@Injectable()
export class MarketplaceAccounts {
  constructor(
    @InjectModel(MarketplaceMember.name) private readonly members: Model<MarketplaceMember>,
    private readonly jwt: JwtService,
    private readonly locations: LocationsService,
  ) {}

  async login({ phone, password }: MarketplaceLoginDto) {
    const demoLogin = process.env.SEED_MARKETPLACE_DEMO === 'true' && process.env.NODE_ENV !== 'production' &&
      ['+989214234099', '+989112244099'].includes(phone);
    if (password.length < 8 && !demoLogin) throw new UnauthorizedException();
    const member = await this.members.findOne({ phone, isActive: { $ne: false } }).select('+passwordHash').exec();
    if (!await verifyPassword(password, member?.passwordHash) || !member) throw new UnauthorizedException();
    const accessToken = await this.jwt.signAsync({ sub: member.id, scope: 'marketplace' }, { expiresIn: 3600 });
    return { accessToken, expiresIn: 3600 };
  }

  async requireMember(authorization?: string) {
    const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    let id: string;
    try {
      const claims = await this.jwt.verifyAsync<{ sub?: unknown; scope?: unknown }>(token, { algorithms: ['HS256'] });
      if (claims.scope !== 'marketplace' || typeof claims.sub !== 'string' || !isObjectIdOrHexString(claims.sub)) throw new Error();
      id = claims.sub;
    } catch {
      throw new UnauthorizedException();
    }
    const member = await this.members.findOne({ _id: id, isActive: { $ne: false } }).exec();
    if (!member) throw new UnauthorizedException();
    return member;
  }

  private view(member: MarketplaceMember) {
    return {
      fullName: member.fullName, phone: member.phone, email: member.email, organization: member.organization,
      address: member.address, province: member.province, city: member.city,
      provinceCode: member.provinceCode, cityCode: member.cityCode, customerType: member.customerType,
      producerType: member.producerType, productionActivity: member.productionActivity,
      serviceTypes: member.serviceTypes, serviceArea: member.serviceArea,
      serviceCredential: member.serviceCredential, vehicle: member.vehicle,
      sellerStatus: member.sellerReview?.status,
      driverStatus: member.driverReview?.status,
      specialistStatus: member.specialistReview?.status,
      capabilities: {
        buy: true,
        sell: Boolean(member.producerType && member.sellerReview?.status === 'approved'),
        drive: Boolean(member.serviceTypes.includes('driver') && member.vehicle && member.driverReview?.status === 'approved'),
        services: member.serviceTypes.filter(type => type !== 'driver' &&
          (!needsSpecialistReview([type]) || member.specialistReview?.status === 'approved')),
      },
    };
  }

  async profile(authorization?: string) {
    return this.view(await this.requireMember(authorization));
  }

  async update(authorization: string | undefined, input: MarketplaceProfileDto) {
    const member = await this.requireMember(authorization);
    if (Object.values(input).some(value => value === null)) throw new BadRequestException('مقدار خالی نامعتبر است.');
    const previous = member.serviceTypes ?? [];
    const services = input.serviceTypes ?? previous;
    const wantsDriver = services.includes('driver');
    const specialist = needsSpecialistReview(services);
    const vehicle = input.vehicle ?? member.vehicle;
    const credential = input.serviceCredential ?? member.serviceCredential;
    if (wantsDriver && !vehicle) throw new BadRequestException('برای رانندگی مشخصات وسیله و گواهینامه را ثبت کنید.');
    if (specialist && !credential) throw new BadRequestException('برای نظارت یا کنترل کیفیت، مرجع مدرک را ثبت کنید.');

    const previousProducer = member.producerType;
    const producerType = input.producerType === undefined ? previousProducer : input.producerType || undefined;
    const vehicleChanged = input.vehicle !== undefined && (
      input.vehicle.type !== member.vehicle?.type || input.vehicle.plate !== member.vehicle?.plate || input.vehicle.license !== member.vehicle?.license
    );
    const changed = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    delete changed.producerType;
    delete changed.vehicle;
    delete changed.serviceCredential;
    member.set({ ...changed, ...await this.locations.memberPlacement(input, member), producerType });
    if (!producerType) member.sellerReview = undefined;
    else if (!member.sellerReview || producerType !== previousProducer || member.isModified('productionActivity')) {
      member.sellerReview = { status: 'pending' };
    }
    if (wantsDriver) {
      member.vehicle = vehicle;
      if (!member.driverReview || !previous.includes('driver') || vehicleChanged) member.driverReview = { status: 'pending' };
    } else {
      member.vehicle = undefined;
      member.driverReview = undefined;
    }
    if (specialist) {
      const changedCredential = credential !== member.serviceCredential;
      member.serviceCredential = credential;
      const addedSpecialty = services.some(type => needsSpecialistReview([type]) && !previous.includes(type));
      if (!member.specialistReview || changedCredential || addedSpecialty) member.specialistReview = { status: 'pending' };
    } else {
      member.serviceCredential = undefined;
      member.specialistReview = undefined;
    }
    try {
      return this.view(await member.save());
    } catch (error) {
      if (error instanceof MongoError.VersionError) throw new ConflictException('پروفایل تغییر کرده است. دوباره بارگذاری کنید.');
      throw error;
    }
  }
}
