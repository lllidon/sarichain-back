import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';

export const normalizeDirectoryText = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? normalizeDirectoryText(value) : value;
const contactNumber = ({ value }: { value: unknown }) => typeof value === 'string' ? normalizeDirectoryText(value)
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[\s()\-]/g, '') : value;

export class DirectoryQueryDto extends CatalogQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) @Transform(trim) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) @Transform(trim) province?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() tagId?: string;
}

export class SupplierDto {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @ApiProperty() @Transform(contactNumber) @Matches(/^\+?[0-9]{7,15}$/) phone!: string;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) province!: string;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) city!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined && value !== '') @Transform(contactNumber) @Matches(/^\+?[0-9]{7,15}$/) alternatePhone?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined && value !== '') @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined && value !== '') @IsString() @MaxLength(2048) @Matches(/^https?:\/\/[^\s/]+\S*$/i) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) hours?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1500) description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(30) @IsMongoId({ each: true }) tagIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) feedbackCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) positiveFeedbackCount?: number;
}

export class SupplierUpdateDto extends PartialType(SupplierDto, { skipNullProperties: false }) {}
