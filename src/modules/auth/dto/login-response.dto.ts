import { ApiProperty } from '@nestjs/swagger';

export class LoginResponseDto {
  @ApiProperty({ description: 'توکن دسترسی JWT' })
  accessToken!: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 3600, description: 'اعتبار توکن به ثانیه' })
  expiresIn!: number;
}
