import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { MembersModule } from '../members/members.module';
import { OrganizationModule } from '../organization/organization.module';
import { InspectionsController, OrganizationInspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';

@Module({
  imports: [AuthModule, MembersModule, OrganizationModule],
  controllers: [InspectionsController, OrganizationInspectionsController],
  providers: [InspectionsService, AccessTokenGuard],
})
export class InspectionsModule {}
