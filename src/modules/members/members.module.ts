import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OrganizationModule } from '../organization/organization.module';
import { memberModels } from './member.schemas';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [AuthModule, OrganizationModule, MongooseModule.forFeature(memberModels)],
  controllers: [MembersController],
  providers: [MembersService, AccessTokenGuard],
})
export class MembersModule {}
