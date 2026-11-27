import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsMongoId, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Types } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { type AccessRequest } from '../auth/access';
import { InventoryWorkflowService } from './inventory-workflow.service';

class WarehouseDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/) id!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsIn(['main', 'staging']) type!: 'main' | 'staging';
}
class OpeningBalanceDto {
  @IsString() @MinLength(2) warehouseId!: string;
  @IsMongoId() productId!: string;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) quantity!: number;
}
class StageOrderDto {
  @IsString() @MinLength(2) sourceWarehouseId!: string;
}
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

  @Post('warehouses')
  createWarehouse(@Body() input: WarehouseDto, @Req() { access }: AccessRequest) {
    return this.inventory.createWarehouse({ ...input, actor: this.actor(access) });
  }

  @Post('opening-balances')
  setOpeningBalance(@Body() input: OpeningBalanceDto, @Req() { access }: AccessRequest) {
    return this.inventory.setOpeningBalance({
      ...input, actor: this.actor(access), correlationId: 'opening:' + input.warehouseId + ':' + input.productId,
    });
  }

  @Get('balances')
  getBalances(@Query('warehouseId') warehouseId: string) {
    if (!warehouseId) throw new BadRequestException('شناسه انبار الزامی است.');
    return this.inventory.getBalances(warehouseId);
  }

  @Get('staging-balances')
  getStagingBalances() {
    return this.inventory.getStagingBalances();
  }

  @Post('orders/:orderId/stage')
  stageOrder(@Param('orderId') orderId: string, @Body() input: StageOrderDto, @Req() { access }: AccessRequest) {
    return this.inventory.stageOrder(orderId, input.sourceWarehouseId, this.actor(access), 'stage:' + orderId);
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
