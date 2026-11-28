import {
  BadRequestException, Body, Controller, Get, Headers, Header, Param, Patch, Post,
  Req, StreamableFile, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Connection, Types } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AccessRequest } from '../auth/access';
import { MarketplaceAccounts } from '../members/marketplace-account.service';
import { InspectionsService } from './inspections.service';

@ApiTags('inspections')
@ApiBearerAuth()
@Controller('web/inspections')
export class InspectionsController {
  constructor(private readonly accounts: MarketplaceAccounts, private readonly inspections: InspectionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async overview(@Headers('authorization') authorization?: string) {
    const member = await this.accounts.requireMember(authorization);
    return this.inspections.overview(member._id);
  }

  @Post('applications')
  @Header('Cache-Control', 'private, no-store')
  async apply(@Headers('authorization') authorization: string | undefined, @Body() input: Record<string, any>) {
    const member = await this.accounts.requireMember(authorization);
    return this.inspections.submitApplication(member._id, input);
  }

  @Post('requests')
  @Header('Cache-Control', 'private, no-store')
  async request(@Headers('authorization') authorization: string | undefined, @Body() input: Record<string, any>) {
    const member = await this.accounts.requireMember(authorization);
    return this.inspections.submitRequest(member._id, input);
  }

  @Patch('assignments/:id/decision')
  @Header('Cache-Control', 'private, no-store')
  async decide(@Headers('authorization') authorization: string | undefined, @Param('id') id: string,
    @Body() input: { decision?: string; availabilityIndex?: number }) {
    const member = await this.accounts.requireMember(authorization);
    return this.inspections.decideAssignment(member._id, id, input.decision, input.availabilityIndex);
  }

  @Post('assignments/:id/report')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FilesInterceptor('photos', 8, { limits: { fileSize: 3 * 1024 * 1024, files: 8, fields: 12, fieldSize: 8192 } }))
  async report(@Headers('authorization') authorization: string | undefined, @Param('id') id: string,
    @Body() input: Record<string, any>, @UploadedFiles() files: Array<{ buffer: Buffer; mimetype: string }>) {
    const member = await this.accounts.requireMember(authorization);
    return this.inspections.submitReport(member._id, id, input, files || []);
  }

  @Get('reports/:reportId/photos/:photoId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(@Headers('authorization') authorization: string | undefined, @Param('reportId') reportId: string,
    @Param('photoId') photoId: string) {
    const member = await this.accounts.requireMember(authorization);
    const photo = await this.inspections.readPhoto(member._id, reportId, photoId);
    return new StreamableFile(photo.buffer, { type: photo.mimeType });
  }
}

@ApiTags('organization-inspections')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('organization/inspections')
export class OrganizationInspectionsController {
  constructor(private readonly inspections: InspectionsService, @InjectConnection() private readonly connection: Connection) {}

  private authorize(request: AccessRequest) {
    if (!['management', 'admin'].includes(request.access?.role || '')) {
      throw new BadRequestException('دسترسی مدیریت لازم است.');
    }
  }

  @Get('overview')
  @Header('Cache-Control', 'private, no-store')
  async overview(@Req() request: AccessRequest) {
    this.authorize(request);
    return this.inspections.adminOverview();
  }

  @Get('policy')
  @Header('Cache-Control', 'private, no-store')
  async policy(@Req() request: AccessRequest) {
    this.authorize(request);
    return this.inspections.readPolicy();
  }

  @Patch('policy')
  async savePolicy(@Req() request: AccessRequest, @Body() input: Record<string, any>) {
    this.authorize(request);
    return this.inspections.savePolicy(input);
  }

  @Patch('applications/:memberId')
  async reviewApplication(@Req() request: AccessRequest, @Param('memberId') memberId: string,
    @Body() input: { status?: string; note?: string }) {
    this.authorize(request);
    return this.inspections.reviewApplication(memberId, input.status, input.note, request.userId);
  }

  @Patch('requests/:id/review')
  async reviewRequest(@Req() request: AccessRequest, @Param('id') id: string,
    @Body() input: { status?: string; note?: string }) {
    this.authorize(request);
    return this.inspections.reviewRequest(id, input.status, input.note, request.userId);
  }
}
