# بک‌اند ساری چین

NestJS، TypeScript و MongoDB. ماژول `auth` با شماره موبایل ایران و رمز عبور وارد می‌شود و توکن JWT یک‌ساعته برمی‌گرداند.

## راه‌اندازی محلی

به Node.js نسخه ۲۲ یا بالاتر و یک سرور MongoDB نیاز دارید. برنامه از دیتابیس `sarichain` و مجموعه `users` استفاده می‌کند.

```bash
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

خروجی دستور آخر را به‌عنوان `JWT_SECRET` در `.env` بگذارید. در صورت نیاز نشانی MongoDB را با `MONGODB_URI` تنظیم کنید. روی محیط اشتراکی، رازها را از طریق متغیرهای محیطی یا مدیر اسرار وارد کنید.

```bash
npm run build
read -r -p 'Mobile: ' AUTH_USER_PHONE
read -r -s -p 'Password: ' AUTH_USER_PASSWORD
printf '\n'
AUTH_USER_PHONE="$AUTH_USER_PHONE" AUTH_USER_PASSWORD="$AUTH_USER_PASSWORD" npm run auth:create-user
unset AUTH_USER_PHONE AUTH_USER_PASSWORD
npm start
```

اسکریپت مدیریت کاربر به Bash نیاز دارد. یک شماره موبایل ایران و رمز ۸ تا ۱۲۸ کاراکتری برای کاربر اولیه وارد کنید. رمز در MongoDB به‌شکل هش scrypt ذخیره می‌شود. برای توسعه با بارگذاری خودکار، از `npm run start:dev` استفاده کنید.

## Swagger

- [Swagger UI](http://localhost:3001/docs)
- [OpenAPI JSON](http://localhost:3001/docs-json)

در Swagger عملیات `POST /auth/login` را باز کنید و شماره و رمز کاربر ساخته‌شده را وارد کنید. شماره در قالب `09123456789` یا `+989123456789` پذیرفته می‌شود. پاسخ موفق شامل `accessToken`، `tokenType` و `expiresIn` است.

## ساختار

```text
src/
├── app.module.ts
├── main.ts
├── config/
├── modules/
│   └── auth/
│       ├── dto/
│       └── schemas/
└── scripts/
```

ماژول‌های بعدی می‌توانند در مسیر `src/modules/` کنار `auth` قرار بگیرند.
