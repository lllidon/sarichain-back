import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { CatalogQueryDto } from '../catalog/catalog-query.dto';
import cities from './data/cities.json';
import provinces from './data/provinces.json';
import { City, Province } from './locations.schemas';

type Placement = { province?: string; city?: string; provinceCode?: string; cityCode?: string };
const codePattern = /^\d{1,10}$/;
const nameSort = { name: 1, code: 1 } as const;
const fold = (value: string) => value.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک');

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Province.name) private readonly provinces: Model<Province>,
    @InjectModel(City.name) private readonly cities: Model<City>,
  ) {}

  async importMissing() {
    await Promise.all([this.provinces.init(), this.cities.init()]);
    const provinceCodes = new Set(await this.provinces.distinct('code'));
    const missingProvinces = provinces.filter(row => !provinceCodes.has(row.code));
    if (missingProvinces.length) {
      await this.provinces.bulkWrite(missingProvinces.map(row => ({
        updateOne: { filter: { code: row.code }, update: { $setOnInsert: row }, upsert: true },
      })));
      for (const row of missingProvinces) provinceCodes.add(row.code);
    }
    if (cities.some(row => !provinceCodes.has(row.provinceCode))) {
      throw new Error('Reference cities contain an unknown province code.');
    }

    const cityCodes = new Set(await this.cities.distinct('code'));
    const missingCities = cities.filter(row => !cityCodes.has(row.code));
    for (let offset = 0; offset < missingCities.length; offset += 1000) {
      await this.cities.bulkWrite(missingCities.slice(offset, offset + 1000).map(row => ({
        updateOne: { filter: { code: row.code }, update: { $setOnInsert: row }, upsert: true },
      })));
    }
  }

  listProvinces() {
    return this.provinces.find().select('-_id code name').collation({ locale: 'fa' }).sort(nameSort).lean().exec();
  }

  async listCities(provinceCode: string | undefined, query: CatalogQueryDto) {
    if (provinceCode !== undefined && !codePattern.test(provinceCode)) throw new BadRequestException('کد استان معتبر نیست.');
    if (provinceCode && !await this.provinces.exists({ code: provinceCode })) throw new NotFoundException('استان یافت نشد.');
    const term = fold(query.search ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      ...(provinceCode && { provinceCode }),
      ...(term && { $or: [{ name: new RegExp(term.replace(/ی/g, '[یي]').replace(/ک/g, '[کك]'), 'iu') }, { code: term }] }),
    };
    const [items, total] = await Promise.all([
      this.cities.find(filter).select('-_id code name provinceCode').collation({ locale: 'fa' })
        .sort(nameSort).skip((query.page - 1) * query.limit).limit(query.limit).lean().exec(),
      this.cities.countDocuments(filter).exec(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async city(code: string) {
    if (!codePattern.test(code)) throw new BadRequestException('کد شهر معتبر نیست.');
    const city = await this.cities.findOne({ code }).select('-_id code name provinceCode').lean();
    if (!city) throw new NotFoundException('شهر یافت نشد.');
    return city;
  }

  async memberPlacement(input: Placement, existing?: Placement | null): Promise<Placement> {
    const changes: Placement = {};
    if (input.provinceCode !== undefined) {
      changes.provinceCode = input.provinceCode;
      changes.province = input.province ?? '';
      if (input.provinceCode) {
        const province = await this.provinces.findOne({ code: input.provinceCode }).select('name').lean();
        if (!province) throw new BadRequestException('استان انتخاب‌شده معتبر نیست.');
        changes.province = province.name;
      }
      if (input.provinceCode !== (existing?.provinceCode ?? '') && input.cityCode === undefined) {
        changes.cityCode = '';
        changes.city = '';
      }
    } else if (input.province !== undefined && fold(input.province) !== fold(existing?.province ?? '')) {
      changes.provinceCode = '';
      changes.cityCode = '';
      if (input.city === undefined) changes.city = '';
    }

    if (input.cityCode !== undefined) {
      changes.cityCode = input.cityCode;
      changes.city = input.city ?? '';
      if (input.cityCode) {
        const provinceCode = changes.provinceCode ?? existing?.provinceCode;
        const city = provinceCode && await this.cities.findOne({ code: input.cityCode, provinceCode }).select('name').lean();
        if (!city) throw new BadRequestException('شهر انتخاب‌شده متعلق به این استان نیست.');
        changes.city = city.name;
      }
    } else if (input.city !== undefined && fold(input.city) !== fold(existing?.city ?? '')) {
      changes.cityCode = '';
    }
    return changes;
  }
}
