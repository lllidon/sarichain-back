import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { memberModels } from './member.schemas';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [AuthModule, MongooseModule.forFeature(memberModels)],
  controllers: [MembersController],
  providers: [MembersService, AccessTokenGuard, AdminGuard],
})
export class MembersModule {}
