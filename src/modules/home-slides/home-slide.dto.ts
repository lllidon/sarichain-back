import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class HomeSlideWriteDto {
  @IsString() @MaxLength(120) eyebrow!: string;
  @IsString() @MaxLength(180) title!: string;
  @IsString() @MaxLength(500) description!: string;
  @IsString() @MaxLength(2048) @Matches(/^(?:https?:\/\/[a-z0-9][^\s/]*\/[^\s]*|\/(?!\/)[^\s\\]+)$/i) imageUrl!: string;
  @IsString() @MaxLength(180) imageAlt!: string;
  @IsString() @MaxLength(60) cta!: string;
  @IsString() @MaxLength(2048) @Matches(/^(?:https?:\/\/[a-z0-9][^\s/]*\/[^\s]*|\/(?!\/)[^\s\\]+)$/i) href!: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) order?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
