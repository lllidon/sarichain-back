import { AccessTokenGuard } from './access-token.guard';
import { AllowClient, type AccessRequest } from './access';
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @AllowClient()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'no-store')
  me(@Req() { access }: AccessRequest) { return access; }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ورود با نام کاربری یا شماره موبایل و رمز عبور' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'ساختار ورودی نامعتبر است' })
  @ApiUnauthorizedResponse({ description: 'شناسه ورود یا رمز عبور اشتباه است' })
  @ApiResponse({ status: 429, description: 'تعداد تلاش‌ها بیش از حد مجاز است' })
  login(@Body() input: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(input);
  }
}
