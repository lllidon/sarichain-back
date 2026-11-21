import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import { mobileNumberPattern, normalizePhone } from '../phone';

export class LoginDto {
  @ApiProperty({ example: '09123456789', description: 'شماره موبایل ایران در قالب 09 یا +98' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(mobileNumberPattern, { message: 'phone must be a valid Iranian mobile number' })
  phone!: string;

  @ApiProperty({ format: 'password', minLength: 1, maxLength: 128, writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
}
