import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsMongoId, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';

export const cartLineLimit = 50;

export class CartSelection {
  @IsMongoId() productId!: string;
  @IsOptional() @IsMongoId() offerId?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,29}$/) unitId?: string;
}

export class CartMutation extends CartSelection {
  @IsIn(['add', 'reduce', 'set']) operation!: 'add' | 'reduce' | 'set';
  @IsOptional() @IsUUID('4') key?: string;
  @IsOptional() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) quantity?: number;
}

class GuestLine extends CartSelection {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) quantity!: number;
}

export class MergeCart {
  @IsArray() @ArrayMaxSize(cartLineLimit) @ValidateNested({ each: true }) @Type(() => GuestLine)
  items!: GuestLine[];
}

export class AcknowledgeCart {
  @IsArray() @ArrayMaxSize(cartLineLimit) @IsUUID('4', { each: true })
  ids!: string[];
}
