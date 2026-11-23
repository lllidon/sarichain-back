import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { WebWorkspaceController } from './web-workspace.controller';
import { WebDeliveryController, WebOrdersController } from './web-orders.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { LocationsModule } from '../locations/locations.module';
import { OrganizationModule } from '../organization/organization.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { MarketplaceAccountController } from './marketplace-account.controller';
import { MarketplaceAccounts } from './marketplace-account.service';
import { MarketplaceMigration } from './marketplace-migration.service';
import { memberModels } from './member.schemas';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [ProductsModule, AuthModule, OrganizationModule, LocationsModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]), MongooseModule.forFeature(memberModels)],
  controllers: [MembersController, MarketplaceAccountController, WebOrdersController, WebDeliveryController, WebWorkspaceController],
  providers: [MembersService, AccessTokenGuard, MarketplaceAccounts, MarketplaceMigration],
})
export class MembersModule {}
