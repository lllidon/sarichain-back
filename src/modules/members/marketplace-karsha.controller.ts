import { Controller, Get, Header, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MarketplaceAccounts } from './marketplace-account.service';
import { KarshaLedgerService } from './karsha-ledger.service';

@ApiTags('karsha')
@ApiBearerAuth()
@Controller(['marketplace', 'web'])
export class MarketplaceKarshaController {
  constructor(private readonly accounts: MarketplaceAccounts, private readonly karsha: KarshaLedgerService) {}

  @Get('karsha')
  @Header('Cache-Control', 'private, no-store')
  async summary(@Headers('authorization') authorization?: string) {
    const member = await this.accounts.requireMember(authorization);
    return this.karsha.summary(member.id);
  }

  @Get('karsha/transactions')
  @Header('Cache-Control', 'private, no-store')
  async transactions(@Headers('authorization') authorization?: string, @Query('page') pageText = '1') {
    const member = await this.accounts.requireMember(authorization);
    const page = /^\d+$/.test(pageText) ? Math.max(1, Math.min(100000, Number(pageText))) : 1;
    return this.karsha.listTransactions(member.id, page, 20);
  }
}
