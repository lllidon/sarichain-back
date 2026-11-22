import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model } from 'mongoose';
import { Tag } from '../catalog/tag.schema';
import { DirectoryQueryDto, normalizeDirectoryText, SupplierUpdateDto } from './directory.dto';
import { MaterialSupplier } from './directory.schema';

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const publicFields = 'name phone alternatePhone contactName province city address hours description email website tagIds';

@Injectable()
export class DirectoryService {
  constructor(
    @InjectModel(MaterialSupplier.name) private readonly suppliers: Model<MaterialSupplier>,
    @InjectModel(Tag.name) private readonly tags: Model<Tag>,
  ) {}

  async list(query: DirectoryQueryDto, manage = false) {
    const search = query.search?.trim();
    const literal = search ? new RegExp(escaped(normalizeDirectoryText(search)), 'iu') : null;
    const filter = {
      ...(!manage && { isActive: true }),
      ...(query.city && { city: new RegExp('^' + escaped(query.city) + '$', 'iu') }),
      ...(query.province && { province: new RegExp('^' + escaped(query.province) + '$', 'iu') }),
      ...(query.tagId && { tagIds: query.tagId }),
      ...(literal && { $or: [{ name: literal }, { contactName: literal }, { description: literal }, { phone: literal }] }),
    };
    const [items, total] = await Promise.all([
      this.suppliers.find(filter).select(manage ? publicFields + ' isActive priority feedbackCount positiveFeedbackCount feedbackScore' : publicFields)
        .sort({ priority: -1, feedbackScore: -1, feedbackCount: -1, _id: 1 }).skip((query.page - 1) * query.limit).limit(query.limit)
        .populate('tagIds', 'name').lean().exec(),
      this.suppliers.countDocuments(filter).exec(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async save(input: SupplierUpdateDto, id?: string) {
    if (Object.values(input).some(value => value === null)) throw new BadRequestException('مقدار خالی نامعتبر است.');
    const supplier = id ? await this.suppliers.findById(id).exec() : new this.suppliers();
    if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد.');
    if (input.tagIds && await this.tags.countDocuments({ _id: { $in: input.tagIds } }) !== input.tagIds.length) {
      throw new BadRequestException('یک یا چند تگ وجود ندارد.');
    }
    const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    supplier.set(changes);
    if (supplier.positiveFeedbackCount > supplier.feedbackCount) throw new BadRequestException('تعداد بازخورد مثبت از کل بازخورد بیشتر است.');
    supplier.feedbackScore = (supplier.positiveFeedbackCount + 2) / (supplier.feedbackCount + 4);
    try {
      return await supplier.save();
    } catch (error) {
      if (error instanceof MongooseError.ValidationError) throw new BadRequestException('اطلاعات تأمین‌کننده معتبر نیست.');
      if (error instanceof MongooseError.VersionError) throw new ConflictException("رکورد تغییر کرده است. فهرست را دوباره باز کنید.");
      throw error;
    }
  }
}
