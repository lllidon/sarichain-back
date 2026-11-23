import { BadRequestException, Controller, Get, Header, NotFoundException, Param, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { Connection, mongo } from 'mongoose';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';

function imageType(buffer: Buffer) {
  if (buffer.length > 12 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length > 12 && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

@ApiTags('catalog-images')
@Controller('web/catalog-images')
export class CatalogImagesController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get images() {
    return this.connection.db!.collection<{ _id: string; data: mongo.Binary; type: string }>('catalog_images');
  }

  @Post()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(AccessTokenGuard, AdminGuard)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } }))
  async upload(@UploadedFile() file?: { buffer: Buffer }) {
    const type = file && imageType(file.buffer);
    if (!file || !type) throw new BadRequestException('فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.');
    const id = createHash('sha256').update(file.buffer).digest('hex');
    await this.images.updateOne({ _id: id }, { $setOnInsert: { type, data: new mongo.Binary(file.buffer) } }, { upsert: true });
    return { url: '/web/catalog-images/' + id };
  }

  @Get(':id')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(@Param('id') id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new NotFoundException();
    const image = await this.images.findOne({ _id: id });
    if (!image) throw new NotFoundException();
    return new StreamableFile(image.data.value(), { type: image.type });
  }
}
