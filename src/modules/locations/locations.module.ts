import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LocationsController } from './locations.controller';
import { locationModels } from './locations.schemas';
import { LocationsService } from './locations.service';

@Module({
  imports: [MongooseModule.forFeature(locationModels)],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
