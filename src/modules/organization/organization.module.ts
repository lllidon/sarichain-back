import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { OrganizationController } from './organization.controller';
import { StoreOrdersController } from './store-orders.controller';
import { OrganizationKarshaController } from './organization-karsha.controller';
import { KarshaLedgerService } from '../members/karsha-ledger.service';
import { organizationModels } from './organization.schemas';

@Module({
  imports: [AuthModule, MongooseModule.forFeature(organizationModels)],
  // Register the static store-orders routes before OrganizationController's dynamic :list routes.
  controllers: [StoreOrdersController, OrganizationKarshaController, OrganizationController],
  providers: [AccessTokenGuard, AdminGuard, KarshaLedgerService],
  exports: [MongooseModule, KarshaLedgerService],
})
export class OrganizationModule {}
