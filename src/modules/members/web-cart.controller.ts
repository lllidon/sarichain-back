import { Body, Controller, Delete, Get, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AcknowledgeCart, CartMutation, MergeCart } from '../cart/cart.dto';
import { CartService } from '../cart/cart.service';
import { MarketplaceAccounts } from './marketplace-account.service';

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/cart')
export class WebCartController {
  constructor(private readonly accounts: MarketplaceAccounts, private readonly cart: CartService) {}

  @Get()
  async read(@Headers('authorization') authorization: string | undefined) {
    return this.cart.read((await this.accounts.requireMember(authorization))._id);
  }

  @Post('items')
  async mutate(@Headers('authorization') authorization: string | undefined, @Body() input: CartMutation) {
    return this.cart.mutate((await this.accounts.requireMember(authorization))._id, input);
  }

  @Post('merge')
  async merge(@Headers('authorization') authorization: string | undefined, @Body() input: MergeCart) {
    return this.cart.merge((await this.accounts.requireMember(authorization))._id, input);
  }

  @Post('acknowledge')
  async acknowledge(@Headers('authorization') authorization: string | undefined, @Body() input: AcknowledgeCart) {
    return this.cart.acknowledge((await this.accounts.requireMember(authorization))._id, input.ids);
  }

  @Delete()
  async clear(@Headers('authorization') authorization: string | undefined) {
    return this.cart.clear((await this.accounts.requireMember(authorization))._id);
  }
}
