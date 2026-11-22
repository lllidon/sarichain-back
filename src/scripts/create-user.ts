import { MembersService } from '../modules/members/members.service';
import { MemberGroup } from '../modules/members/member-types';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { mobileNumberPattern, normalizePhone } from '../modules/auth/phone';

async function createUser() {
  const phone = normalizePhone(process.env.AUTH_USER_PHONE ?? '');
  const password = process.env.AUTH_USER_PASSWORD ?? '';
  if (!mobileNumberPattern.test(phone) || password.length < 8 || password.length > 128) {
    throw new Error('Set AUTH_USER_PHONE and AUTH_USER_PASSWORD (8 to 128 characters).');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  try {
    await app.get(MembersService).save(MemberGroup.Users, { phone, password }, undefined, undefined, true);
    console.log('User created.');
  } finally {
    await app.close();
  }
}

void createUser().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not create user.');
  process.exitCode = 1;
});
