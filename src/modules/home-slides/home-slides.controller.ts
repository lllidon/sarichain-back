import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isObjectIdOrHexString, Model } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { HomeSlide } from './home-slide.schema';
import { HomeSlideWriteDto } from './home-slide.dto';

@Controller('home-slides')
@UseGuards(AccessTokenGuard, AdminGuard)
export class HomeSlidesController {
  constructor(@InjectModel(HomeSlide.name) private readonly slides: Model<HomeSlide>) {}

  @Get()
  async list() {
    return this.slides.find().sort({ order: 1, createdAt: 1 }).lean().exec();
  }

  @Post()
  create(@Body() input: HomeSlideWriteDto) {
    return this.slides.create(input);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() input: HomeSlideWriteDto) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه اسلایدر معتبر نیست.');
    const slide = await this.slides.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true }).lean().exec();
    if (!slide) throw new BadRequestException('اسلاید پیدا نشد.');
    return slide;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه اسلایدر معتبر نیست.');
    await this.slides.findByIdAndDelete(id).exec();
  }
}

@Controller('web/home-slides')
export class PublicHomeSlidesController {
  constructor(@InjectModel(HomeSlide.name) private readonly slides: Model<HomeSlide>) {}

  @Get()
  async list() {
    return this.slides.find({ isActive: true })
      .sort({ order: 1, createdAt: 1 })
      .select('eyebrow title description imageUrl imageAlt cta href order')
      .lean().exec();
  }
}
