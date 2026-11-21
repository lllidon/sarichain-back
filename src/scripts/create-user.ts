import { getModelToken } from '@nestjs/mongoose';
import { NestFactory } from '@nestjs/core';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { hashPassword } from '../modules/auth/password';
import { mobileNumberPattern, normalizePhone } from '../modules/auth/phone';
import { User } from '../modules/auth/schemas/user.schema';

async function createUser() {
  const phone = normalizePhone(process.env.AUTH_USER_PHONE ?? '');
  const password = process.env.AUTH_USER_PASSWORD ?? '';
  if (!mobileNumberPattern.test(phone) || password.length < 8 || password.length > 128) {
    throw new Error('Set AUTH_USER_PHONE and AUTH_USER_PASSWORD (8 to 128 characters).');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  try {
    const users = app.get<Model<User>>(getModelToken(User.name));
    await users.init();
    await users.create({ phone, passwordHash: await hashPassword(password) });
    console.log('User created.');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      throw new Error('A user with this phone number already exists.');
    }
    throw new Error('Could not create user in MongoDB.');
  } finally {
    await app.close();
  }
}

void createUser().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not create user.');
  process.exitCode = 1;
});
