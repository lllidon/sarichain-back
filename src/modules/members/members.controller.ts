import { BadRequestException, Body, Controller, Get, Header, Param, ParseEnumPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { isObjectIdOrHexString } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { MemberDto } from './member.dto';
import { MemberGroup } from './member-types';
import { MembersService } from './members.service';

@ApiTags('members')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, AdminGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get(':group')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'group', enum: MemberGroup })
  list(@Param('group', new ParseEnumPipe(MemberGroup)) group: MemberGroup, @Query() query: CatalogQueryDto) {
    return this.members.list(group, query);
  }

  @Post(':group')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'group', enum: MemberGroup })
  create(@Param('group', new ParseEnumPipe(MemberGroup)) group: MemberGroup, @Body() input: MemberDto) {
    return this.members.save(group, input);
  }

  @Patch(':group/:id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'group', enum: MemberGroup })
  update(@Param('group', new ParseEnumPipe(MemberGroup)) group: MemberGroup, @Param('id') id: string,
    @Body() input: MemberDto, @Req() request: { userId: string }) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('شناسه عضو معتبر نیست.');
    return this.members.save(group, input, id, request.userId);
  }
}
