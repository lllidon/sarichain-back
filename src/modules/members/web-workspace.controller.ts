import { Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, ParseEnumPipe, Post, Query } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { Connection, Types, isObjectIdOrHexString } from 'mongoose';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { MarketplaceAccounts } from './marketplace-account.service';

enum Section {
  Products = 'products',
  Transport = 'transport',
  Bulletin = 'bulletin',
  Orchards = 'orchards',
  Advisory = 'advisory',
}

class WorkspaceEntryDto {
  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 120) title!: string;

  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 1000) details!: string;
}

@ApiTags('web')
@ApiBearerAuth()
@Controller('web/workspace')
export class WebWorkspaceController {
  constructor(private readonly accounts: MarketplaceAccounts, @InjectConnection() private readonly connection: Connection) {}

  private get entries() {
    return this.connection.db!.collection('web_workspace_entries');
  }

  @Get(':section')
  async list(@Headers('authorization') authorization: string | undefined,
    @Param('section', new ParseEnumPipe(Section)) section: Section, @Query() { page, limit }: CatalogQueryDto) {
    const member = await this.accounts.requireMember(authorization);
    const filter = section === Section.Bulletin ? { section } : { section, memberId: member._id };
    const [items, total] = await Promise.all([
      this.entries.find(filter, { projection: { section: 0 } }).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).toArray(),
      this.entries.countDocuments(filter),
    ]);
    return {
      items: items.map(({ _id, memberId, title, details, createdAt }) =>
        ({ id: _id, title, details, createdAt, owned: member._id.equals(memberId) })),
      total, page, limit,
    };
  }

  @Post(':section')
  async create(@Headers('authorization') authorization: string | undefined,
    @Param('section', new ParseEnumPipe(Section)) section: Section, @Body() input: WorkspaceEntryDto) {
    const member = await this.accounts.requireMember(authorization);
    const { insertedId } = await this.entries.insertOne({
      section, memberId: member._id, title: input.title, details: input.details, createdAt: new Date(),
    });
    return { id: insertedId };
  }

  @Delete(':section/:id')
  @HttpCode(204)
  async remove(@Headers('authorization') authorization: string | undefined,
    @Param('section', new ParseEnumPipe(Section)) section: Section, @Param('id') id: string) {
    const member = await this.accounts.requireMember(authorization);
    if (!isObjectIdOrHexString(id)) throw new NotFoundException();
    const result = await this.entries.deleteOne({ _id: new Types.ObjectId(id), section, memberId: member._id });
    if (!result.deletedCount) throw new NotFoundException();
  }
}
