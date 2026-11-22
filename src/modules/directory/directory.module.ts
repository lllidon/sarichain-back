import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DirectoryController } from './directory.controller';
import { MaterialSupplier, MaterialSupplierSchema } from './directory.schema';
import { DirectoryService } from './directory.service';

@Module({
  imports: [
    AuthModule, CatalogModule,
    MongooseModule.forFeature([{ name: MaterialSupplier.name, schema: MaterialSupplierSchema }]),
  ],
  controllers: [DirectoryController],
  providers: [DirectoryService, AccessTokenGuard, AdminGuard],
})
export class DirectoryModule {}
