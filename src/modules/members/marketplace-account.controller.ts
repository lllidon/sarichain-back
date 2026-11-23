import { Body, Controller, Get, Header, Headers, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { MarketplaceAccounts } from './marketplace-account.service';
import { MarketplaceLoginDto, MarketplaceProfileDto } from './marketplace.dto';

@ApiTags('marketplace')
@Controller(['marketplace', 'web'])
export class MarketplaceAccountController {
  constructor(private readonly accounts: MarketplaceAccounts) {}

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  login(@Body() input: MarketplaceLoginDto) { return this.accounts.login(input); }

  @Get('profile')
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  profile(@Headers('authorization') authorization?: string) { return this.accounts.profile(authorization); }

  @Patch('profile')
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  update(@Headers('authorization') authorization: string | undefined, @Body() input: MarketplaceProfileDto) {
    return this.accounts.update(authorization, input);
  }
}
