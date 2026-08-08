# Smartboss — Phase 1 (App Shell + Login)

โครง (shell) ของ Smartboss: ระบบ Login (JWT + Refresh Rotation), RBAC foundation,
App Shell (Sidebar + Topbar) และหน้า Home ที่แสดง 6 โมดูลสถานะ "เร็ว ๆ นี้"
**ยังไม่มีฟีเจอร์ภายในโมดูล** — โมดูลจะถูกเสียบผ่าน Module Registry ใน Phase ถัดไป

## Tech Stack
Turborepo + pnpm · Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict ·
Tailwind v4 + CSS variables ·
Prisma (PostgreSQL — schema `core` + `maintenance`) · JWT (jose) + Argon2id · Zod · Redis (ioredis)

## โครงสร้าง
```
apps/web                 Next.js app (login, shell, home, auth API, proxy)
packages/ui              design tokens (tokens.css) + shared components
packages/auth            jwt / refresh rotation / session / guard / rate limit / audit
packages/database        prisma schema (core) + seed + singleton client
packages/config          tsconfig ที่ใช้ร่วมกัน
```

## เริ่มต้นใช้งาน (Dev)

ต้องมี **Node 20+**, **pnpm**, และ **Docker** (สำหรับ Postgres + Redis)

```bash
# 1) ติดตั้ง dependencies
pnpm install

# 2) เตรียม environment (แก้ค่าใน .env ตามต้องการ)
cp .env.example .env
cp .env apps/web/.env          # ให้ Next โหลด env ตอน dev

# 3) รัน Postgres + Redis
docker compose up -d

# 4) สร้างตารางและ seed ข้อมูล (10 roles, 6 modules, 6 users)
pnpm db:migrate
pnpm db:seed

# 5) รัน dev server
pnpm dev                        # http://localhost:3000
```

> หมายเหตุ: Next.js โหลด `.env` จากโฟลเดอร์ `apps/web` — ขั้นที่ 2 จึง copy ไปไว้ที่นั่นด้วย
> (`.env` ทุกไฟล์ถูก gitignore แล้ว)

### บัญชีทดสอบ (จาก seed)
| อีเมล | รหัสผ่าน | role |
|---|---|---|
| `admin@smartboss.app` | `SEED_ADMIN_PASSWORD` ใน `.env` | SUPER_ADMIN |
| `staff@smartboss.app` | `SEED_STAFF_PASSWORD` ใน `.env` | STAFF |

## Deploy (Vercel + Neon)

> 📖 **หัวข้อนี้ครอบคลุมแค่ `apps/web`** — ระบบมีอีก 3 โปรเซสที่ Vercel รันไม่ได้
> (workforce API / worker / device gateway) และลำดับ bootstrap ฐานข้อมูลมีรายละเอียดที่พลาดแล้วพัง
> ขึ้นระบบจริงให้ทำตาม **[docs/deploy.md](docs/deploy.md)** ทั้งฉบับ

### ตั้งค่า Vercel project
| ช่อง | ค่า |
|---|---|
| Root Directory | `apps/web` |
| Framework | Next.js (auto) |
| Build / Install command | ปล่อย default — `prisma generate` รันเองผ่าน `postinstall` ของ `packages/database` |

[apps/web/vercel.json](apps/web/vercel.json) ตั้ง region `sin1` (สิงคโปร์ ใกล้ Neon) และ cron
`/api/cron/maintenance?task=all` เวลา 01:00 UTC = **08:00 น. เวลาไทย** (cron ของ Vercel เป็น UTC เสมอ)

### Environment variables บน Vercel
| ตัวแปร | ที่มา |
|---|---|
| `DATABASE_URL` | Neon เส้น **pooled** (โฮสต์มี `-pooler`) |
| `DATABASE_URL_UNPOOLED` | Neon เส้น **direct** — Prisma CLI ใช้ |
| `REDIS_URL` | Upstash (`rediss://…`) — ไม่ตั้ง = rate limit fail-open |
| `JWT_SECRET` | สุ่มใหม่ ≥32 ตัวอักษร **ห้ามใช้ค่าเดียวกับ dev** |
| `COOKIE_SECURE` | `true` |
| `CRON_SECRET` | สุ่ม — Vercel Cron จะแนบเป็น Bearer token ให้เอง ไม่ตั้ง = cron ตอบ 503 |
| `S3_*` | bucket ของไฟล์แนบ (ดูหัวข้อถัดไป) |

> ถ้าเชื่อม Neon ผ่าน Vercel Marketplace ตัว `DATABASE_URL` + `DATABASE_URL_UNPOOLED` จะถูก inject ให้อัตโนมัติ

### ไฟล์แนบ — ต้องใช้ object storage
Vercel เขียน filesystem ไม่ได้ โหมด local disk (`.uploads/`) จึงใช้ได้แค่ dev
ตั้ง `S3_BUCKET` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` แล้ว
[storage.ts](apps/web/modules/maintenance/lib/storage.ts) จะสลับ backend เอง — ใช้กับ S3-compatible ทุกตัว
(**Cloudflare R2** แนะนำเพราะไม่คิดค่า egress · AWS S3 · MinIO)

รูปทุกใบเข้าถึงผ่าน `/api/files/<key>` ซึ่ง **ต้อง login** แล้วจะ 302 ไป presigned URL อายุ 5 นาที
URL ใน DB เก็บเป็น `/api/files/<key>` เสมอ ไม่ผูกกับ backend → ย้าย storage ไม่ต้อง migrate ข้อมูล

### Migration
**ไม่ได้** ผูก `prisma migrate deploy` ไว้กับ build เพราะ preview deployment จะยิง migration
ใส่ production DB ด้วย รันมือก่อน deploy:
```bash
DATABASE_URL=<pooled> DATABASE_URL_UNPOOLED=<direct> pnpm db:deploy
```

## คำสั่งที่ใช้บ่อย
```bash
pnpm dev            # รันทุก app แบบ dev
pnpm build          # build production
pnpm typecheck      # ตรวจ type ทั้ง workspace
pnpm lint           # lint (web)
pnpm db:studio      # เปิด Prisma Studio
pnpm --filter @smartboss/auth test   # unit test ของ jwt sign/verify
```

## Auth flow โดยสรุป
- **Login** `POST /api/auth/login` → rate limit (Redis, 10/นาที/IP) → verif
Argon2id →
  ออก Access JWT (15 นาที) + Refresh token (7 วัน, SHA-256 ใน DB) → set httpOnly cookies
- **Refresh** `POST /api/auth/refresh` → rotation; ตรวจ token reuse → revoke ทุก session + audit
- **Logout** `POST /api/auth/logout` → revoke refresh + ลบ cookies
- **Me** `GET /api/auth/me` → คืนข้อมูล user + roles + permissions
- **Proxy** ([apps/web/proxy.ts](apps/web/proxy.ts) — เดิมชื่อ middleware.ts ก่อนขึ้น Next 16)
  ป้องกันทุก route ยกเว้น `/login`, `/u/*`, static → redirect `/login?next=…`
  `/api/*` เปิดเฉพาะ `auth/`, `cron/`, `webhooks/` เท่านั้น (ตัดสินก่อนกฎ static
  ไม่งั้น `/api/files/<key>.jpg` จะถูกนับเป็นไฟล์ static แล้วหลุด auth)

Login ผิด 5 ครั้ง → ล็อกบัญชี 15 นาที (audit `ACCOUNT_LOCKED`)
Access token ต่ออายุอัตโนมัติเบื้องหลังผ่าน `SessionRefresher`

