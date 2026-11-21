import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
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
  await app.get(AuthService).initializeAdmin(config.get<string>('BOOTSTRAP_ADMIN_PASSWORD'));
  await app.listen(config.getOrThrow<number>('PORT'));
}

void bootstrap();
