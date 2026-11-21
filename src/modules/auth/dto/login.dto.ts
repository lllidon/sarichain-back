import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches, ValidateIf } from 'class-validator';
import { mobileNumberPattern, normalizePhone } from '../phone';

export class LoginDto {
  @ApiPropertyOptional({ example: '09123456789', description: 'شماره موبایل ایران، در صورت ورود بدون نام کاربری' })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(mobileNumberPattern, { message: 'phone must be a valid Iranian mobile number' })
  phone?: string;

  @ApiPropertyOptional({ example: 'milad', description: 'نام کاربری، در صورت ورود بدون شماره موبایل' })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{2,31}$/)
  username?: string;

  @ApiProperty({ format: 'password', minLength: 1, maxLength: 128, writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
}
