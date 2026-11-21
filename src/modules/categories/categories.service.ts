import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CatalogEntryInput } from '../catalog-common/catalog-entry';
import { Category } from './schemas/category.schema';

@Injectable()
export class CategoriesService {
  constructor(@InjectModel(Category.name) private readonly categories: Model<Category>) {}

  async create(input: CatalogEntryInput & { parentId?: Types.ObjectId | null }) {
    const parentId = input.parentId ?? null;
    const parent = parentId ? await this.categories.findById(parentId).select('level').lean().exec() : null;
    if (parentId && !parent) throw new BadRequestException('Parent category does not exist.');

    const level = (parent?.level ?? 0) + 1;
    if (level > 3) throw new BadRequestException('Categories can have at most three levels.');

    await this.categories.init();
    return this.categories.create({ ...input, parentId, level });
  }

  async acceptsProducts(id: Types.ObjectId): Promise<boolean> {
    return Boolean(await this.categories.exists({ _id: id, level: { $in: [2, 3] } }));
  }
}
