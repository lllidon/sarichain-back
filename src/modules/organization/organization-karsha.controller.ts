import { BadRequestException, Body, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AccessRequest } from '../auth/access';
import { KarshaLedgerService } from '../members/karsha-ledger.service';

@ApiTags('organization-karsha')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, AdminGuard)
@Controller('organization')
export class OrganizationKarshaController {
  constructor(private readonly karsha: KarshaLedgerService) {}

  @Get('karsha-policy')
  @Header('Cache-Control', 'private, no-store')
  policy() { return this.karsha.readPolicy(); }

  @Post('karsha-policy')
  async savePolicy(@Body() input: { rateTomanPerKarsha?: number | null }) {
    if (input.rateTomanPerKarsha !== undefined && input.rateTomanPerKarsha !== null &&
      (typeof input.rateTomanPerKarsha !== 'number' || !Number.isFinite(input.rateTomanPerKarsha))) {
      throw new BadRequestException('نرخ کارسا باید عدد معتبر باشد.');
    }
    return this.karsha.savePolicy(input);
  }

  @Get('karsha-ledger')
  @Header('Cache-Control', 'private, no-store')
  ledger(@Query('memberId') memberId?: string, @Query('page') pageText = '1') {
    if (memberId && !/^[a-f0-9]{24}$/i.test(memberId)) throw new BadRequestException('شناسه عضو معتبر نیست.');
    const page = /^\d+$/.test(pageText) ? Math.max(1, Math.min(100000, Number(pageText))) : 1;
    return this.karsha.adminLedger({ memberId, page, limit: 30 });
  }

  @Post('karsha-adjustments')
  async adjust(@Req() request: AccessRequest, @Body() input: {
    memberId?: string; direction?: string; amount?: number; reason?: string; idempotencyKey?: string;
  }) {
    if (!input.memberId || !/^[a-f0-9]{24}$/i.test(input.memberId) ||
      !['credit', 'debit'].includes(input.direction || '') ||
      typeof input.amount !== 'number' || !Number.isFinite(input.amount) ||
      typeof input.reason !== 'string' || !input.reason.trim() ||
      typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) {
      throw new BadRequestException('اطلاعات افزایش یا کاهش کارسا معتبر نیست.');
    }
    const options = { reason: input.reason, actor: request.userId, idempotencyKey: input.idempotencyKey, kind: 'admin_adjustment' };
    return input.direction === 'credit'
      ? this.karsha.credit(input.memberId, input.amount, options)
      : this.karsha.debit(input.memberId, input.amount, { ...options, type: 'admin_debit' });
  }

  @Post('karsha-decay/sweep')
  async sweep() { return this.karsha.sweepDueLots(); }
}
