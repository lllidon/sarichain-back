import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsMongoId, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Types } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { type AccessRequest } from '../auth/access';
import { InventoryWorkflowService } from './inventory-workflow.service';

class AccountingPostingDto {
  @IsString() @MinLength(1) @MaxLength(120) externalDocumentId!: string;
}

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, AdminGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryWorkflowService) {}

  private actor(access: AccessRequest['access']) {
    return { id: new Types.ObjectId(access.id), type: 'member' as const };
  }

  @Get('staging-balances')
  getStagingBalances() {
    return this.inventory.getStagingBalances();
  }

  @Get('products')
  getProductStockSummary(
    @Query('search') search = '',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const parsedPage = Number(page), parsedLimit = Number(limit);
    if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('شماره صفحه و تعداد در صفحه معتبر نیست.');
    }
    return this.inventory.getProductStockSummary(search, parsedPage, parsedLimit);
  }

  @Post('orders/:orderId/stage')
  stageOrder(@Param('orderId') orderId: string, @Req() { access }: AccessRequest) {
    return this.inventory.stageOrder(orderId, this.actor(access), 'stage:' + orderId);
  }

  @Post('orders/:orderId/release-staging')
  releaseStagedOrder(@Param('orderId') orderId: string, @Body() input: ReleaseReservationDto, @Req() { access }: AccessRequest) {
    return this.inventory.releaseStagedOrder(orderId, input.reason, this.actor(access), 'release:' + orderId);
  }

  @Post('orders/:orderId/accounting-posted')
  confirmAccountingPosting(@Param('orderId') orderId: string, @Body() input: AccountingPostingDto, @Req() { access }: AccessRequest) {
    return this.inventory.confirmAccountingPosting(orderId, input.externalDocumentId, this.actor(access), 'accounting:' + orderId);
  }

  @Get('movements')
  getMovements(
    @Query('orderId') orderId?: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit === undefined ? 100 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
      throw new BadRequestException('limit باید عددی بین ۱ تا ۵۰۰ باشد.');
    }
    return this.inventory.getMovements({ orderId, productId, warehouseId, limit: parsedLimit });
  }

  @Get('orders/:orderId/logs')
  getOrderLogs(@Param('orderId') orderId: string) {
    return this.inventory.getOrderLogs(orderId);
  }
}
