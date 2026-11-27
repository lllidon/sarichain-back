import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { OrganizationController } from './organization.controller';
import { StoreOrdersController } from './store-orders.controller';
import { organizationModels } from './organization.schemas';

@Module({
  imports: [AuthModule, MongooseModule.forFeature(organizationModels)],
  controllers: [OrganizationController, StoreOrdersController],
  providers: [AccessTokenGuard, AdminGuard],
  exports: [MongooseModule],
})
export class OrganizationModule {}
