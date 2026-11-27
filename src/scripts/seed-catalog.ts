import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CatalogDemoService } from '../modules/catalog/demo/catalog-demo.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    await app.get(CatalogDemoService).seed();
    console.log('Food marketplace demo catalog seeded successfully.');
  } finally {
    await app.close();
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
