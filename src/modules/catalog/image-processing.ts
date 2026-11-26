import { BadRequestException } from '@nestjs/common';
import { join } from 'node:path';
import sharp from 'sharp';

export const maxUploadImageBytes = 2 * 1024 * 1024;
const watermarkPath = join(__dirname, '../../../public/sarichain-watermark.svg');
const maxStoredImageBytes = 10 * 1024 * 1024;

function imageType(buffer: Buffer) {
  if (buffer.length > 12 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length > 12 && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function addWatermark(buffer: Buffer) {
  const image = sharp(buffer, { animated: true, autoOrient: true, limitInputPixels: 16_000_000 });
  const { autoOrient, pageHeight, pages = 1 } = await image.metadata();
  const { width } = autoOrient;
  const height = pageHeight ?? autoOrient.height;
  const shortSide = Math.min(width, height);
  const size = Math.min(120, Math.max(1, Math.round(shortSide * 0.15)));
  const inset = Math.min(Math.floor((shortSide - size) / 2), Math.max(1, Math.round(shortSide * 0.03)));
  const { data, info } = await sharp(watermarkPath)
    .resize(size, size, { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = width - info.width - inset;

  if (pages > 1 && pageHeight) {
    const frame = await sharp(data).extend({
      top: inset,
      right: inset,
      bottom: height - inset - info.height,
      left,
      background: 'transparent',
    }).png().toBuffer();
    return image.composite([{ input: frame, tile: true, gravity: 'northwest' }]).toBuffer();
  }
  return image.composite([{ input: data, left, top: inset }]).toBuffer();
}

export async function prepareUploadedImage(buffer?: Buffer) {
  const type = buffer && imageType(buffer);
  if (!buffer || !type) throw new BadRequestException('فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.');
  let data: Buffer;
  try {
    data = await addWatermark(buffer);
  } catch {
    throw new BadRequestException('تصویر قابل پردازش نیست. یک تصویر سالم تا ۱۶ مگاپیکسل بارگذاری کنید.');
  }
  if (data.length > maxStoredImageBytes) {
    throw new BadRequestException('حجم تصویر پس از افزودن نشان بیش از حد مجاز است.');
  }
  return { data, type };
}
