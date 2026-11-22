import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsMongoId, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { mobileNumberPattern, normalizePhone } from '../auth/phone';

export class MemberDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() profileId?: string;
  @ApiPropertyOptional({ enum: ['admin', 'client'] }) @IsOptional() @IsIn(['admin', 'client']) role?: 'admin' | 'client';
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @IsString() @Length(1, 160) fullName?: string;
  @ApiPropertyOptional({ example: '09123456789' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString() @Matches(mobileNumberPattern) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) type?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined && value !== '') @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) organization?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) province?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) productionActivity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) serviceArea?: string;
  @ApiPropertyOptional({ writeOnly: true }) @IsOptional() @IsString() @Length(8, 128) password?: string;
}
