import { LocationsService } from './modules/locations/locations.service';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';
import { MarketplaceMigration } from './modules/members/marketplace-migration.service';
import { MembersService } from './modules/members/members.service';
import { CatalogDemoService } from './modules/catalog/demo/catalog-demo.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  app.useStaticAssets(join(__dirname, '..', 'public', 'catalog-demo'), { prefix: '/catalog-demo/' });
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sarichain API')
    .setDescription('ورود با نام کاربری یا شماره موبایل و رمز عبور')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, swaggerConfig));
  const config = app.get(ConfigService);
  const auth = app.get(AuthService);
  await app.get(MarketplaceMigration).run();
  await auth.migrateInitialAdmin();
  await auth.initializeAdmin(config.get<string>('BOOTSTRAP_ADMIN_PASSWORD'));
  if (config.get<string>('SEED_ACCESS_DEMO') === 'true') {
    await app.get(MembersService).seedOrganization(config.getOrThrow<string>('SEED_ACCESS_DEMO_PASSWORD'));
  }
  if (config.get<string>('SEED_CATALOG_DEMO') === 'true') {
    await app.get(CatalogDemoService).seed();
  }
  await app.get(LocationsService).importMissing();
  await app.listen(config.getOrThrow<number>('PORT'));
}

void bootstrap();
