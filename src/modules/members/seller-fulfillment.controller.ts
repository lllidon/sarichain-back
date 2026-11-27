import { BadRequestException, Body, Controller, Get, Header, Headers, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MarketplaceAccounts } from './marketplace-account.service';
import { SellerFulfillmentService } from './seller-fulfillment.service';

@ApiTags('seller-fulfillment')
@ApiBearerAuth()
@Controller('web/workspace/seller-orders')
export class SellerFulfillmentController {
  constructor(private readonly accounts: MarketplaceAccounts, private readonly fulfillment: SellerFulfillmentService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Headers('authorization') authorization: string | undefined,
    @Query('page') pageText = '1', @Query('limit') limitText = '20', @Query('status') status = 'active') {
    const member = await this.accounts.requireMember(authorization);
    const page = /^\d+$/.test(pageText) ? Math.max(1, Math.min(10000, Number(pageText))) : 1;
    const limit = /^\d+$/.test(limitText) ? Math.max(1, Math.min(50, Number(limitText))) : 20;
    if (!['active', 'all', 'completed'].includes(status)) throw new BadRequestException('فیلتر سفارش معتبر نیست.');
    return this.fulfillment.list(member._id, page, limit, status);
  }

  @Patch(':orderId/status')
  async update(@Headers('authorization') authorization: string | undefined, @Param('orderId') orderId: string,
    @Body() input: { status?: string }) {
    const member = await this.accounts.requireMember(authorization);
    if (typeof input.status !== 'string') throw new BadRequestException('وضعیت جدید الزامی است.');
    return this.fulfillment.update(member._id, orderId, input.status);
  }
}
