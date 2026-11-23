import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class MoneyDto {
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER)
  amount!: number;

  @IsString() @Matches(/^[A-Za-z]{3}$/)
  currency!: string;
}

class PriceRangeDto {
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1_000_000) min!: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1_000_000) max!: number;
}

class SaleUnitDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,29}$/) code!: string;
  @IsString() @MaxLength(40) name!: string;
  @IsInt() @Min(2) @Max(1000) quantity!: number;
}

class DimensionsDto {
  @IsNumber() @Min(Number.MIN_VALUE) lengthMm!: number;
  @IsNumber() @Min(Number.MIN_VALUE) widthMm!: number;
  @IsNumber() @Min(Number.MIN_VALUE) heightMm!: number;
}

class PhysicalDto {
  @IsOptional() @IsNumber() @Min(Number.MIN_VALUE) standardDensityKgM3?: number;
  @IsOptional() @IsNumber() @Min(Number.MIN_VALUE) shippingWeightG?: number;
  @IsOptional() @ValidateNested() @Type(() => DimensionsDto) shippingDimensions?: DimensionsDto;
}

class OptionDto {
  @IsString() @MaxLength(80) name!: string;
  @IsString() @MaxLength(160) value!: string;
}

export class CatalogWriteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) thumbnailUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) shortDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsMongoId({ each: true }) tagIds?: string[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsMongoId() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) itemId?: string;
  @ApiPropertyOptional({ enum: ['master', 'variant'] }) @IsOptional() @IsIn(['master', 'variant']) kind?: 'master' | 'variant';
  @ApiPropertyOptional() @IsOptional() @IsMongoId() masterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() categoryId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsMongoId() brandId?: string | null;
  @ApiPropertyOptional({ type: 'object', properties: { amount: { type: 'integer' }, currency: { type: 'string' } } })
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) basePrice?: MoneyDto;
  @ApiPropertyOptional() @IsOptional() @IsInt() priceAdjustment?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) saleUnit?: string;
  @ApiPropertyOptional({ type: [SaleUnitDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ArrayUnique((item: SaleUnitDto) => item?.code)
  @ValidateNested({ each: true }) @Type(() => SaleUnitDto) saleUnits?: SaleUnitDto[];
  @ApiPropertyOptional({ type: 'object', nullable: true, properties: { min: { type: 'number' }, max: { type: 'number' } } })
  @IsOptional() @ValidateNested() @Type(() => PriceRangeDto) price?: PriceRangeDto | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional() @ValidateNested() @Type(() => PhysicalDto) physical?: PhysicalDto;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } } })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
}

export class TagWriteDto {
  @ApiProperty({ example: 'کشاورزی' })
  @IsString()
  @MaxLength(60)
  name!: string;
}
