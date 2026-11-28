import { CartModule } from '../cart/cart.module';
import { WebCartController } from './web-cart.controller';
import { WebWeeklyBasketController } from './web-weekly-basket.controller';
import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { WebWorkspaceController } from './web-workspace.controller';
import { WebTransportOrdersController } from './web-transport-orders.controller';
import { WebDeliveryController, WebOrdersController } from './web-orders.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { LocationsModule } from '../locations/locations.module';
import { OrganizationModule } from '../organization/organization.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { MarketplaceAccountController } from './marketplace-account.controller';
import { AccountUpgradesController } from './account-upgrades.controller';
import { MarketplaceAccounts } from './marketplace-account.service';
import { MarketplaceMigration } from './marketplace-migration.service';
import { memberModels } from './member.schemas';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { OrderPersistenceService } from './order-persistence.service';
import { InventoryWorkflowService } from './inventory-workflow.service';
import { MarketplaceKarshaController } from './marketplace-karsha.controller';
import { InventoryController } from './inventory.controller';
import { SellerFulfillmentController } from './seller-fulfillment.controller';
import { SellerFulfillmentService } from './seller-fulfillment.service';

@Module({
  imports: [CartModule, ProductsModule, AuthModule, OrganizationModule, LocationsModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]), MongooseModule.forFeature(memberModels)],
  controllers: [MembersController, MarketplaceAccountController, MarketplaceKarshaController, AccountUpgradesController, WebOrdersController, WebDeliveryController, SellerFulfillmentController, WebWorkspaceController, WebTransportOrdersController, WebCartController, WebWeeklyBasketController, InventoryController],
  providers: [MembersService, AccessTokenGuard, AdminGuard, MarketplaceAccounts, MarketplaceMigration, OrderPersistenceService, InventoryWorkflowService, SellerFulfillmentService],
  exports: [MarketplaceAccounts],
})
export class MembersModule {}
