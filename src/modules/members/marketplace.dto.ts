import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsIn, IsObject, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf, ValidateNested, IsNumber, Min, Max } from 'class-validator';
import { mobileNumberPattern, normalizePhone } from '../auth/phone';
import { MemberGroup, memberTypes, vehicleTypes } from './member-types';

const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class MarketplaceLoginDto {
  @ApiProperty({ example: '09123456789' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString() @Matches(mobileNumberPattern) phone!: string;

  @ApiProperty({ writeOnly: true }) @IsString() @Length(1, 128) password!: string;
}

class VehicleDto {
  @ApiProperty({ enum: vehicleTypes }) @IsIn(vehicleTypes) type!: string;
  @ApiProperty() @Transform(trimmed) @IsString() @Length(2, 40) plate!: string;
  @ApiProperty() @Transform(trimmed) @IsString() @Length(2, 80) license!: string;
}

class DeliveryAddressDto {
  @ApiProperty() @IsString() @Matches(/^[a-zA-Z0-9-]{8,40}$/) id!: string;
  @ApiProperty() @Transform(trimmed) @IsString() @Length(1, 80) title!: string;
  @ApiProperty() @Transform(trimmed) @IsString() @Length(1, 160) recipientName!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(32) phone?: string;
  @ApiProperty() @Transform(trimmed) @IsString() @Length(5, 500) address!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) province?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[0-9۰-۹-]{0,20}$/) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
}

export class MarketplaceProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @Length(1, 160) fullName?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined && value !== '') @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) organization?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional({ type: [DeliveryAddressDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique((item: DeliveryAddressDto) => item.id) @ValidateNested({ each: true }) @Type(() => DeliveryAddressDto) deliveryAddresses?: DeliveryAddressDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{0,10}$/) provinceCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{0,10}$/) cityCode?: string;
  @ApiPropertyOptional({ enum: memberTypes[MemberGroup.Customers] })
  @IsOptional() @IsIn(memberTypes[MemberGroup.Customers]) customerType?: string;
  @ApiPropertyOptional({ enum: [...memberTypes[MemberGroup.Producers], ''] })
  @IsOptional() @IsIn([...memberTypes[MemberGroup.Producers], '']) producerType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) productionActivity?: string;
  @ApiPropertyOptional({ enum: memberTypes[MemberGroup.Services], isArray: true })
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ArrayUnique() @IsIn(memberTypes[MemberGroup.Services], { each: true }) serviceTypes?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) serviceArea?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(120) serviceCredential?: string;
  @ApiPropertyOptional({ type: VehicleDto }) @IsOptional() @IsObject() @ValidateNested() @Type(() => VehicleDto) vehicle?: VehicleDto;
}
