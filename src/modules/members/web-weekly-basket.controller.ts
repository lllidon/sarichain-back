import { BadRequestException, Body, Controller, Delete, Get, Headers, Post } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { Connection, Types } from 'mongoose';
import { MarketplaceAccounts } from './marketplace-account.service';

class WeeklyBasketMutation {
  @IsMongoId() productId!: string;
  @IsIn(['add', 'set', 'remove']) operation!: 'add' | 'set' | 'remove';
  @IsOptional() @IsInt() @Min(1) @Max(9999) quantity?: number;
}

interface WeeklyBasketRecord {
  _id: Types.ObjectId;
  revision: number;
  items: Array<{ productId: string; quantity: number }>;
}

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/weekly-basket')
export class WebWeeklyBasketController {
  constructor(
    private readonly accounts: MarketplaceAccounts,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private get baskets() {
    return this.connection.db!.collection<WeeklyBasketRecord>('web_weekly_baskets');
  }

  private async view(memberId: Types.ObjectId) {
    const record = await this.baskets.findOne({ _id: memberId });
    return { revision: record?.revision ?? 0, items: record?.items ?? [] };
  }

  @Get()
  async read(@Headers('authorization') authorization?: string) {
    const member = await this.accounts.requireMember(authorization);
    return this.view(member._id);
  }

  @Post('items')
  async mutate(@Headers('authorization') authorization: string | undefined, @Body() input: WeeklyBasketMutation) {
    const member = await this.accounts.requireMember(authorization);
    const productId = new Types.ObjectId(input.productId);
    const product = await this.connection.db!.collection('products').findOne(
      { _id: productId, isActive: { $ne: false } }, { projection: { _id: 1 } },
    );
    if (!product) throw new BadRequestException('محصول انتخاب‌شده در دسترس نیست.');

    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.baskets.findOne({ _id: member._id });
      const revision = current?.revision ?? 0;
      const items = [...(current?.items ?? [])];
      const index = items.findIndex(item => item.productId === input.productId);
      if (input.operation === 'remove') {
        if (index >= 0) items.splice(index, 1);
      } else if (input.operation === 'set') {
        const quantity = input.quantity;
        if (!Number.isSafeInteger(quantity) || !quantity || quantity < 1 || quantity > 9999) {
          throw new BadRequestException('تعداد باید بین ۱ تا ۹۹۹۹ باشد.');
        }
        if (index >= 0) items[index] = { productId: input.productId, quantity };
        else {
          if (items.length >= 50) throw new BadRequestException('سبد هفتگی حداکثر ۵۰ قلم ظرفیت دارد.');
          items.push({ productId: input.productId, quantity });
        }
      } else {
        const quantity = (items[index]?.quantity ?? 0) + (input.quantity ?? 1);
        if (!Number.isSafeInteger(quantity) || quantity > 9999) throw new BadRequestException('تعداد از سقف مجاز بیشتر است.');
        if (index >= 0) items[index] = { productId: input.productId, quantity };
        else {
          if (items.length >= 50) throw new BadRequestException('سبد هفتگی حداکثر ۵۰ قلم ظرفیت دارد.');
          items.push({ productId: input.productId, quantity });
        }
      }

      if (JSON.stringify(items) === JSON.stringify(current?.items ?? [])) {
        return { revision, items };
      }
      const nextRevision = revision + 1;
      if (!current) {
        try {
          const result = await this.baskets.updateOne(
            { _id: member._id }, { $setOnInsert: { revision: nextRevision, items } }, { upsert: true },
          );
          if (result.upsertedCount) return { revision: nextRevision, items };
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) continue;
          throw error;
        }
      } else {
        const result = await this.baskets.updateOne(
          { _id: member._id, revision }, { $set: { revision: nextRevision, items } },
        );
        if (result.modifiedCount) return { revision: nextRevision, items };
      }
    }
    throw new BadRequestException('سبد هفتگی هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.');
  }

  @Delete()
  async clear(@Headers('authorization') authorization?: string) {
    const member = await this.accounts.requireMember(authorization);
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.baskets.findOne({ _id: member._id });
      if (!current?.items.length) return { revision: current?.revision ?? 0, items: [] };
      const revision = current.revision + 1;
      const result = await this.baskets.updateOne(
        { _id: member._id, revision: current.revision }, { $set: { revision, items: [] } },
      );
      if (result.modifiedCount) return { revision, items: [] };
    }
    throw new BadRequestException('سبد هفتگی هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.');
  }
}
