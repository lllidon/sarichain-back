import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HomeSlide } from './home-slide.schema';

@Injectable()
export class HomeSlidesSeed implements OnModuleInit {
  constructor(@InjectModel(HomeSlide.name) private readonly slides: Model<HomeSlide>) {}

  async onModuleInit() {
    if (await this.slides.exists({})) return;
    await this.slides.insertMany([
      {
        eyebrow: 'از ریشه تا سفره',
        title: 'تازه‌ترین محصولات،\nمستقیم از تولیدکننده',
        description: 'باغداران، کشاورزان و دامداران را پیدا کنید؛ محصولات را مقایسه کنید و با اطمینان خرید کنید.',
        imageUrl: '/img/home/seasonal-market.webp',
        imageAlt: 'بازار محصولات تازه کشاورزی',
        cta: 'مشاهده محصولات', href: '/categories', order: 0, isActive: true,
      },
      {
        eyebrow: 'بازار حرفه‌ای کشاورزی',
        title: 'برای هر مزرعه،\nیک راهکار هوشمند',
        description: 'از نهاده و تجهیزات تا خدمات تخصصی؛ نیازهای کسب‌وکار کشاورزی را یکجا پیدا کنید.',
        imageUrl: '/img/sliderFade.jpg',
        imageAlt: 'فعالیت و تولید در مزرعه',
        cta: 'مشاهده دسته‌ها', href: '/categories', order: 1, isActive: true,
      },
      {
        eyebrow: 'همراه تولیدکنندگان ایرانی',
        title: 'محصول خوب،\nبازار بزرگ‌تری می‌خواهد',
        description: 'عرضه محصولات خود را معرفی کنید و به خریداران عمده و مصرف‌کنندگان دسترسی داشته باشید.',
        imageUrl: '/img/catalog/field.webp',
        imageAlt: 'مزرعه و کشت محصولات کشاورزی',
        cta: 'همکاری با ساری‌چین', href: '/partners', order: 2, isActive: true,
      },
    ]);
  }
}
