# The Movie Link Bot — Telegram Mini App Starter

এই প্রজেক্টে আছে:

- Telegram Bot `/start` + Mini App button
- Telegram Mini App UI
- SQLite database
- Search
- Category filter
- Favorite system
- Unlock system
- View counter
- Admin panel
- Content add/edit/delete
- Category add
- Telegram Mini App `initData` server-side validation

## 1) Requirements

- Node.js 18+
- একটি Telegram Bot Token
- HTTPS domain (production Mini App-এর জন্য)
- নিজের/লাইসেন্সকৃত content বা বৈধ external watch URL

## 2) Install

```bash
npm install
cp .env.example .env
```

`.env`-এ:

```env
BOT_TOKEN=YOUR_BOT_TOKEN
BOT_USERNAME=YourBotUsername
WEB_APP_URL=https://your-domain.com
PORT=3000
ADMIN_PASSWORD=একটি-শক্তিশালী-পাসওয়ার্ড
DEMO_MODE=false
```

তারপর:

```bash
npm start
```

## 3) Telegram-এ Mini App সেট করা

`@BotFather` দিয়ে bot-এর Main Mini App / Web App URL হিসেবে:

`https://your-domain.com`

দাও। Telegram-এর official docs অনুযায়ী Mini App-এ `Telegram.WebApp.initData` server-side validate করা উচিত; এই starter-এ সেটি করা হয়েছে।

## 4) Bot

`/start` পাঠালে bot একটি `Open Mini App` button দেবে।

Menu button-ও startup-এর সময় `setChatMenuButton` দিয়ে `🎬 Open App` হিসেবে সেট করার চেষ্টা করবে।

## 5) Admin Panel

ব্রাউজারে:

`https://your-domain.com/admin`

Admin password দিয়ে login করো।

Content-এর জন্য:
- Title
- Description
- Poster URL
- Watch URL
- Category
- Badge
- Unlock required

সেট করতে পারবে।

## 6) Unlock system

এই starter-এ unlock হলো server-side user/content state। Unlock button চাপলে সেই Telegram user-এর জন্য content unlocked হয়।

এটি payment/ad verification নয়। পরে চাইলে বৈধ subscription/payment বা অন্য eligibility check যোগ করা যাবে।

## 7) Database

প্রথম চালু হলে `database.sqlite` তৈরি হবে।

Tables:
- users
- categories
- content
- favorites
- unlocked

## 8) Production security

- `.env` কখনও GitHub-এ দিও না।
- `ADMIN_PASSWORD` শক্তিশালী করো।
- HTTPS ব্যবহার করো।
- Content URL হিসেবে শুধু নিজের বা লাইসেন্সকৃত/অনুমোদিত content ব্যবহার করো।
- Admin API-তে আরও শক্ত authentication (যেমন session/JWT + rate limit) যোগ করা ভালো।
- Production-এ reverse proxy (Nginx/Caddy) ব্যবহার করতে পারো।

## 9) Design

UI-টি তোমার দেওয়া screenshot-এর মতো dark, mobile-first card layout ধরে তৈরি করা হয়েছে, তবে exact copyrighted artwork/poster assets এখানে bundled নয়।
