import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { HomeSlide, HomeSlideSchema } from './home-slide.schema';
import { HomeSlidesController, PublicHomeSlidesController } from './home-slides.controller';
import { HomeSlidesSeed } from './home-slides.seed';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: HomeSlide.name, schema: HomeSlideSchema }])],
  controllers: [HomeSlidesController, PublicHomeSlidesController],
  providers: [AccessTokenGuard, AdminGuard, HomeSlidesSeed],
})
export class HomeSlidesModule {}
