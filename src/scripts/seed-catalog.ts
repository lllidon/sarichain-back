import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { CatalogDemoService } from '../modules/catalog/demo/catalog-demo.service';
import { demoProducers, demoProducts } from '../modules/catalog/demo/demo-food-catalog';
import { hashPassword } from '../modules/auth/password';
import { LocationsService } from '../modules/locations/locations.service';

const seedKey = 'sarichain-mazandaran-market-demo-v1';
const province = 'مازندران';
const provinceCode = '29';

const towns = [
  { city: 'ساری', code: '348', lat: 36.5659, lng: 53.0586 },
  { city: 'بابل', code: '342', lat: 36.5387, lng: 52.6765 },
  { city: 'آمل', code: '339', lat: 36.4696, lng: 52.3507 },
  { city: 'قائم شهر', code: '332', lat: 36.4631, lng: 52.8604 },
  { city: 'بهشهر', code: '341', lat: 36.6923, lng: 53.5526 },
  { city: 'بابلسر', code: '343', lat: 36.7025, lng: 52.6574 },
  { city: 'نکا', code: '334', lat: 36.6508, lng: 53.2990 },
  { city: 'جویبار', code: '345', lat: 36.6415, lng: 52.9117 },
  { city: 'نوشهر', code: '336', lat: 36.6489, lng: 51.4962 },
  { city: 'چالوس', code: '337', lat: 36.6550, lng: 51.4204 },
  { city: 'تنکابن', code: '344', lat: 36.8163, lng: 50.8738 },
  { city: 'رامسر', code: '346', lat: 36.9030, lng: 50.6586 },
  { city: 'نور', code: '335', lat: 36.5745, lng: 52.0150 },
  { city: 'سوادکوه', code: '347', lat: 36.3002, lng: 52.8867 },
];

const customerNames = ['آرمان کاظمی','نگار جعفری','پارسا محمدی','مبینا رضایی','سینا احمدی','الهام کریمی','پویا صادقی','ترانه موسوی','کیان مرادی','آوا نوری'];
const driverNames = ['حمیدرضا عباسی','مجتبی رحمانی','میلاد قنبری','بهنام حیدری','فرزاد اکبری','وحید رستمی','شهرام شریفی','یاسر زمانی','علی‌اکبر اسدی','مهدی یوسفی'];
const serviceNames = ['حسن فلاح','جواد شمس','اکرم صالحی','بهرام نادری','مینا باقری'];
const supervisorNames = ['دکتر پیمان شاکری','مهندس سارا امینی','مهندس کامران توکلی','مهندس مهدیه فرهمند','مهندس رضا بابایی'];

function placement(city: typeof towns[number], index: number, name: string) {
  // These are intentionally approximate city-centre test coordinates, not real home addresses.
  const latitude = Number((city.lat + ((index % 5) - 2) * 0.0013).toFixed(6));
  const longitude = Number((city.lng + ((index % 7) - 3) * 0.0015).toFixed(6));
  const address = 'نشانی نمونه ' + (index + 1) + '، خیابان اصلی، کوچه بهار، پلاک ' + (10 + index) + '، ' + city.city + '، استان مازندران';
  const phone = '+98912000' + String(2001 + index).padStart(4, '0');
  return {
    phone, province, provinceCode, city: city.city, cityCode: city.code, address,
    deliveryAddresses: [{
      id: 'demo-home', title: 'نشانی نمونه', recipientName: name, phone,
      address, province, city: city.city, postalCode: '۴۸۱۰۰۰۰۰۰۰',
      latitude, longitude,
    }],
  };
}

function review(status: 'approved' = 'approved') {
  return { status, reviewedAt: new Date(), reviewedBy: 'demo-seed' };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed is disabled in production. Use a dedicated test database.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    await app.get(LocationsService).importMissing();
    await app.get(CatalogDemoService).seed();

    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) throw new Error('MongoDB is not connected.');

    const members = db.collection('members');
    const phoneRegistry = db.collection('member_phones');
    const products = db.collection('products');
    const workspace = db.collection('web_workspace_entries');
    const password = process.env.DEMO_MEMBER_PASSWORD || 'SarichainDemo#1405';
    if (password.length < 8 || password.length > 128) throw new Error('DEMO_MEMBER_PASSWORD must be 8 to 128 characters.');
    const passwordHash = await hashPassword(password);

    const categoryRows = await db.collection('categories').find({ slug: /^demo-/ }).toArray();
    const categoryIds = new Map(categoryRows.map(row => [row.slug, String(row._id)]));
    const producerIds: Types.ObjectId[] = [];
    let createdMembers = 0;

    async function upsertMember(index: number, fullName: string, profile: Record<string, unknown>) {
      const phone = String(profile.phone);
      const _id = new Types.ObjectId();
      await members.updateOne(
        { phone, demoSeedKey: seedKey },
        { $set: { ...profile, fullName, passwordHash, demoSeedKey: seedKey, isActive: true, updatedAt: new Date() },
          $setOnInsert: { _id, createdAt: new Date() } },
        { upsert: true },
      );
      const member = await members.findOne({ phone, demoSeedKey: seedKey });
      if (!member) throw new Error('Could not create demo member: ' + phone);
      const registered = await phoneRegistry.findOne({ _id: phone });
      if (registered && registered.memberId !== String(member._id)) {
        throw new Error('Demo phone is already reserved by another account: ' + phone);
      }
      await phoneRegistry.updateOne(
        { _id: phone },
        { $set: { group: 'marketplace', memberId: String(member._id) } },
        { upsert: true },
      );
      if (index >= 0) createdMembers++;
      return member;
    }

    // 10 final consumers
    for (let i = 0; i < 10; i++) {
      const city = towns[(i * 3) % towns.length];
      const fullName = customerNames[i];
      await upsertMember(i, fullName, {
        ...placement(city, i, fullName), customerType: 'consumer',
        notes: 'مشتری نهایی آزمایشی؛ ' + seedKey,
      });
    }

    // 10 drivers, with realistic vehicle classes and different nominal payloads.
    const vehicles = [
      ['motorcycle','۴۵ ب ۱۲۳ ایران ۲۲',30,'موتورسیکلت باربر سبک'],
      ['car','۶۸ ج ۴۵۱ ایران ۲۲',350,'خودروی سواری با صندوق بار'],
      ['pickup','۲۱ د ۷۸۹ ایران ۲۲',750,'وانت سبک'],
      ['pickup','۳۳ هـ ۹۱۲ ایران ۲۲',900,'وانت دوکابین'],
      ['van','۴۴ و ۲۳۱ ایران ۲۲',1200,'ون باری'],
      ['van','۵۵ ز ۶۷۸ ایران ۲۲',1500,'ون سقف‌بلند'],
      ['truckette','۶۶ ط ۳۴۵ ایران ۲۲',3500,'کامیونت مسقف'],
      ['truckette','۷۷ ی ۸۹۰ ایران ۲۲',4500,'کامیونت یخچال‌دار'],
      ['truck','۸۸ ب ۱۲۳ ایران ۲۲',8000,'کامیون تک محور'],
      ['truck','۹۹ ج ۴۵۶ ایران ۲۲',12000,'کامیون جفت محور'],
    ] as const;
    for (let i = 0; i < 10; i++) {
      const city = towns[(i * 2 + 1) % towns.length];
      const fullName = driverNames[i];
      const [type, plate, capacityKg, description] = vehicles[i];
      await upsertMember(10 + i, fullName, {
        ...placement(city, 10 + i, fullName), serviceTypes: ['driver'],
        serviceArea: city.city + ' و مسیرهای بین‌شهری مازندران',
        serviceCredential: 'راننده آزمایشی؛ ' + description,
        vehicle: { type, plate, license: 'گواهینامه پایه متناسب با خودرو · نمونه تست', capacityKg },
        driverReview: review(),
        notes: 'ظرفیت اسمی بار ' + capacityKg + ' کیلوگرم؛ ' + seedKey,
      });
    }

    // 20 producers, each assigned exactly 10 products from their own production specialty.
    for (let i = 0; i < demoProducers.length; i++) {
      const producer = demoProducers[i];
      const [key, fullName, organization, producerType, productionActivity, city, cityCode, latitude, longitude] = producer;
      const town = towns.find(item => item.city === city) ?? towns[0];
      const base = placement(town, 20 + i, fullName);
      base.deliveryAddresses[0].latitude = Number((latitude + (i % 3) * 0.0004).toFixed(6));
      base.deliveryAddresses[0].longitude = Number((longitude + (i % 4) * 0.0004).toFixed(6));
      base.cityCode = cityCode;
      const member = await upsertMember(20 + i, fullName, {
        ...base, organization, producerType, productionActivity,
        sellerReview: review(),
        notes: 'تولیدکننده آزمایشی ' + key + '؛ ' + seedKey,
      });
      producerIds[i] = member._id as Types.ObjectId;
    }

    // 5 agricultural service providers: harvesting, orchard picking, spraying, fertilizing and field work.
    const serviceProfiles = [
      ['harvest','خدمات برداشت محصول و جمع‌آوری شالی'],
      ['harvest','چیدن مرکبات، کیوی و میوه‌های باغی'],
      ['labor','سم‌پاشی مجاز و محلول‌پاشی با رعایت دستورالعمل برچسب'],
      ['labor','کوددهی، پخش کود و آماده‌سازی زمین'],
      ['labor','بیل‌زنی، وجین، هرس و کارگر فصلی مزرعه'],
    ] as const;
    for (let i = 0; i < 5; i++) {
      const city = towns[(i * 2 + 4) % towns.length];
      const fullName = serviceNames[i];
      const [type, skill] = serviceProfiles[i];
      await upsertMember(40 + i, fullName, {
        ...placement(city, 40 + i, fullName), serviceTypes: [type],
        serviceArea: city.city + ' و روستاهای اطراف',
        serviceCredential: skill + '؛ پروفایل خدماتی نمونه',
        notes: 'ارائه‌دهنده خدمات کشاورزی آزمایشی؛ ' + seedKey,
      });
    }

    // 5 field supervisors / quality inspectors.
    for (let i = 0; i < 5; i++) {
      const city = towns[(i * 3 + 2) % towns.length];
      const fullName = supervisorNames[i];
      await upsertMember(45 + i, fullName, {
        ...placement(city, 45 + i, fullName), serviceTypes: ['supervisor'],
        serviceArea: 'کل استان مازندران؛ حوزه استقرار ' + city.city,
        serviceCredential: 'ناظر میدانی آزمایشی؛ کنترل کیفیت، بازدید مزرعه و ثبت گزارش',
        specialistReview: review(),
        notes: 'ناظر آزمایشی؛ ' + seedKey,
      });
    }

    // Create one live seller offer for every producer-product pair (200 offers).
    let offers = 0;
    for (let i = 0; i < demoProducts.length; i++) {
      const [code, name, category, price, unit, description, pack, image, producerIndex] = demoProducts[i];
      const product = await products.findOne({ sku: 'SC-' + code, kind: 'master' });
      if (!product) throw new Error('Missing seeded product SC-' + code);
      const sellerId = producerIds[producerIndex];
      if (!sellerId) throw new Error('Missing producer for product SC-' + code);
      const stock = 80 + ((i * 37) % 420);
      const harvestDate = new Date().toISOString().slice(0, 10);
      const offer = {
        productId: product._id, price, stock, reservedStock: 0,
        unit, harvestDate, description: description + '؛ بسته‌بندی ' + pack,
      };
      await workspace.updateOne(
        { demoSeedKey: seedKey, section: 'products', memberId: sellerId, 'offer.productId': product._id },
        { $set: { section: 'products', memberId: sellerId, title: name, offer, demoSeedKey: seedKey, updatedAt: new Date() },
          $setOnInsert: { _id: new Types.ObjectId(), createdAt: new Date() } },
        { upsert: true },
      );
      offers++;
    }

    const counts = {
      customers: await members.countDocuments({ demoSeedKey: seedKey, customerType: { $exists: true } }),
      drivers: await members.countDocuments({ demoSeedKey: seedKey, serviceTypes: 'driver' }),
      producers: await members.countDocuments({ demoSeedKey: seedKey, producerType: { $exists: true } }),
      services: await members.countDocuments({ demoSeedKey: seedKey, serviceTypes: { $in: ['harvest', 'labor'] } }),
      supervisors: await members.countDocuments({ demoSeedKey: seedKey, serviceTypes: 'supervisor' }),
      products: await products.countDocuments({ sku: /^SC-3\d{3}$/ }),
      offers,
    };
    console.log('Mazandaran marketplace demo seed completed:', counts);
    console.log('Demo login password for all 50 accounts:', password);
    console.log('Demo member phones: +989120002001 through +989120002050');
  } finally {
    await app.close();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
