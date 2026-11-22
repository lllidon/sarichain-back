import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { isObjectIdOrHexString } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { DirectoryQueryDto, SupplierDto, SupplierUpdateDto } from './directory.dto';
import { DirectoryService } from './directory.service';

@ApiTags('material-suppliers')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('directory/material-suppliers')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: DirectoryQueryDto) {
    return this.directory.list(query);
  }

  @Get('manage')
  @UseGuards(AdminGuard)
  @Header('Cache-Control', 'private, no-store')
  manage(@Query() query: DirectoryQueryDto) {
    return this.directory.list(query, true);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() body: SupplierDto) {
    return this.directory.save(body);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() body: SupplierUpdateDto) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه معتبر نیست.');
    return this.directory.save(body, id);
  }
}
