import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';

import { AppModule } from '../app.module';
import { demoCategories, demoProducts, demoImageUrls } from '../modules/catalog/demo/demo-food-catalog';

const ROOT = join(process.cwd(), 'public', 'uploads');
const ORIGIN = (process.env.PUBLIC_BACKEND_ORIGIN || 'https://admin.dehaat.ir').replace(/\\/+$/, '');
const MAX_BYTES = 12 * 1024 * 1024;
const stats = { categories: 0, products: 0, skipped: 0, failed: 0 };

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'Sarichain-Catalog-Image-Migration/1.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Expected image, received ${contentType || 'unknown content type'}`);
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_BYTES) throw new Error('Image exceeds 12 MB');

  const source = Buffer.from(await response.arrayBuffer());
  if (!source.length || source.length > MAX_BYTES) throw new Error('Image is empty or exceeds 12 MB');

  return sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();
}

async function saveImage(folder: 'products' | 'category', filename: string, url: string) {
  const safeName = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const directory = join(ROOT, folder);
  await mkdir(directory, { recursive: true });

  const target = join(directory, safeName + '.webp');
  const temporary = target + '.tmp';
  await writeFile(temporary, await downloadImage(url));
  await rename(temporary, target);
  return `${ORIGIN}/uploads/${folder}/${safeName}.webp`;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) throw new Error('MongoDB is not connected.');

    const categories = db.collection('categories');
    const products = db.collection('products');
    console.log('Downloading catalog images into public/uploads ...');

    for (const [key, , , imageKey] of demoCategories) {
      const slug = `demo-${key}`;
      const sourceUrl = demoImageUrls[imageKey];
      if (!sourceUrl) {
        stats.failed++;
        console.error(`[CATEGORY] Missing image source: ${imageKey}`);
        continue;
      }
      try {
        const localUrl = await saveImage('category', slug, sourceUrl);
        const result = await categories.updateOne(
          { slug },
          { $set: { imageUrl: localUrl, thumbnailUrl: localUrl } },
        );
        if (result.matchedCount) {
          stats.categories++;
          console.log(`[CATEGORY] ${slug}`);
        } else {
          stats.skipped++;
          console.warn(`[CATEGORY NOT FOUND] ${slug}`);
        }
      } catch (error) {
        stats.failed++;
        console.error(`[CATEGORY ERROR] ${slug}`, error);
      }
    }

    for (const row of demoProducts) {
      const code = row[0];
      const imageKey = row[7];
      const sku = `SC-${code}`;
      const sourceUrl = demoImageUrls[imageKey];
      if (!sourceUrl) {
        stats.failed++;
        console.error(`[PRODUCT] Missing image source for ${sku}: ${imageKey}`);
        continue;
      }
      try {
        const localUrl = await saveImage('products', sku, sourceUrl);
        const result = await products.updateOne(
          { sku, kind: 'master' },
          { $set: { imageUrl: localUrl, thumbnailUrl: localUrl, gallery: [localUrl] } },
        );
        if (result.matchedCount) {
          stats.products++;
          console.log(`[PRODUCT] ${sku}`);
        } else {
          stats.skipped++;
          console.warn(`[PRODUCT NOT FOUND] ${sku}`);
        }
      } catch (error) {
        stats.failed++;
        console.error(`[PRODUCT ERROR] ${sku}`, error);
      }
    }

    console.log('\n========== IMAGE MIGRATION REPORT ==========');
    console.log(`Categories updated: ${stats.categories}`);
    console.log(`Products updated:   ${stats.products}`);
    console.log(`Skipped:            ${stats.skipped}`);
    console.log(`Failed:             ${stats.failed}`);
    console.log('============================================');
    if (stats.failed) throw new Error('Some image downloads failed. Review the errors and rerun.');
  } finally {
    await app.close();
  }
}

void main().catch(error => {
  console.error('Catalog image download failed:', error);
  process.exitCode = 1;
});
