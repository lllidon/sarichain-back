import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './modules/auth/auth.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { MembersModule } from './modules/members/members.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        dbName: 'sarichain',
      }),
    }),
    AuthModule,
    CatalogModule,
    MembersModule,
    DirectoryModule,
  ],
})
export class AppModule {}
