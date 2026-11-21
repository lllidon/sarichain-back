import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CatalogEntryInput } from '../catalog-common/catalog-entry';
import { Brand } from './schemas/brand.schema';

@Injectable()
export class BrandsService {
  constructor(@InjectModel(Brand.name) private readonly brands: Model<Brand>) {}

  async create(input: CatalogEntryInput) {
    await this.brands.init();
    return this.brands.create(input);
  }

  async exists(id: Types.ObjectId): Promise<boolean> {
    return Boolean(await this.brands.exists({ _id: id }));
  }
}
