# Smartboss — Phase 1 Spec: App Shell + Login (ยังไม่มีโมดูล)

> **เอกสารนี้คือ spec สำหรับสร้าง "โครง" ของ Smartboss เท่านั้น**
> ประกอบด้วย: ระบบ Login (JWT + Refresh Rotation), RBAC foundation, App Shell (Sidebar + Topbar), หน้า Home
> **ห้ามสร้างฟีเจอร์ของโมดูลใด ๆ** (Report-Task, HR, Financial, Maintenance, Sale-Admin, Marketing) — โมดูลจะถูกเสียบเข้ามาภายหลังผ่าน Module Registry

---

## 1. เป้าหมายและขอบเขต

### สิ่งที่ต้องมีเมื่อจบ Phase นี้ (In Scope)
1. Monorepo (Turborepo + pnpm) พร้อมโครงสร้างตามข้อ 3
2. Database schema `core` (users, roles, permissions ฯลฯ) + seed data
3. ระบบ Login: email + password → Access JWT (15 นาที) + Refresh Token rotation (7 วัน, httpOnly cookie)
4. Middleware ป้องกันทุกหน้า ยกเว้น `/login`
5. App Shell: Sidebar + Topbar + พื้นที่ content ธีมขาว
6. Module Registry ที่**ว่างเปล่า**แต่พร้อมใช้งาน (มี type + ฟังก์ชันครบ)
7. หน้า Home แสดง card 6 โมดูลสถานะ "Coming Soon" ตามสีประจำโมดูล
8. หน้า `/login` ตาม UI spec ข้อ 8

### สิ่งที่ห้ามทำใน Phase นี้ (Out of Scope)
- ❌ ฟีเจอร์ภายในโมดูลทั้ง 6
- ❌ หน้า register (ผู้ใช้ถูกสร้างโดย seed/admin เท่านั้น)
- ❌ 2FA, ลืมรหัสผ่าน (เผื่อโครงไว้ได้ แต่ไม่ implement)
- ❌ Multi-tenant

---

## 2. Tech Stack

| ส่วน | เทคโนโลยี | เวอร์ชัน/หมายเหตุ |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | |
| Framework | Next.js (App Router) + TypeScript strict | Next 14+ |
| Styling | Tailwind CSS + CSS Variables | ธีมขาวเป็นฐาน |
| UI Components | shadcn/ui | Button, Input, Card, DropdownMenu, Avatar, Toast |
| ORM | Prisma (`multiSchema` preview feature) | PostgreSQL schema: `core` |
| Database | PostgreSQL 16 (local: Docker Compose) | |
| Auth | JWT (jose) + Argon2id (argon2) | ห้ามใช้ bcrypt/md5 |
| Validation | Zod ทุก input ทั้ง client และ server | |
| Cache/Session | Redis (ioredis) — refresh token allowlist + rate limit | local: Docker Compose |

---

## 3. โครงสร้างโปรเจกต์

```
smartboss/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── (auth)/
│       │   │   └── login/page.tsx          # หน้า Login (ไม่มี Sidebar)
│       │   ├── (shell)/
│       │   │   ├── layout.tsx              # Shell Layout: Sidebar + Topbar
│       │   │   └── page.tsx                # หน้า Home (card 6 โมดูล)
│       │   ├── api/
│       │   │   └── auth/
│       │   │       ├── login/route.ts
│       │   │       ├── refresh/route.ts
│       │   │       ├── logout/route.ts
│       │   │       └── me/route.ts
│       │   ├── layout.tsx                  # root layout + font + tokens
│       │   └── globals.css
│       ├── middleware.ts                   # ตรวจ session ทุก route ยกเว้น /login, /api/auth/*
│       └── module-registry.ts              # ★ registry ว่าง — พร้อมรับโมดูลใน Phase ถัดไป
│
├── packages/
│   ├── ui/                                 # design tokens + shared components
│   │   ├── tokens.css                      # CSS variables (ข้อ 4)
│   │   └── components/
│   ├── auth/                               # logic auth ทั้งหมด (ใช้ซ้ำได้ทุกโมดูลในอนาคต)
│   │   ├── jwt.ts                          # sign/verify access token
│   │   ├── refresh.ts                      # rotation logic
│   │   ├── session.ts                      # getSession() สำหรับ Server Component
│   │   └── guard.ts                        # requireAuth(), requirePermission()
│   ├── database/
│   │   ├── prisma/schema.prisma            # schema core (ข้อ 5)
│   │   ├── seed.ts                         # seed data (ข้อ 10)
│   │   └── client.ts                       # singleton PrismaClient
│   └── config/                             # eslint, tsconfig ที่ใช้ร่วมกัน
│
├── docker-compose.yml                      # postgres + redis สำหรับ dev
├── turbo.json
└── .env.example
```

**กติกา:** ห้าม import ข้าม package โดยตรงนอกเหนือจากที่ประกาศใน `package.json` ของแต่ละ package

---

## 4. Design Tokens (ธีมขาว + สี 6 โมดูล)

สร้างไฟล์ `packages/ui/tokens.css` และ import ใน root layout:

```css
:root {
  /* Base — ธีมขาว */
  --bg: #FFFFFF;
  --bg-soft: #F7F9FC;
  --ink: #1B2537;          /* navy จากโลโก้ Boss */
  --ink-soft: #64748B;
  --line: #E5E9F0;
  --brand-green: #4CB93F;  /* green จากโลโก้ Easy */
  --brand-navy: #1B2537;

  /* Module colors — ใช้ตอนเสียบโมดูลใน Phase ถัดไป */
  --mod-report: #64748B;   /* Report-Task  ขาว-เทา (Slate) */
  --mod-hr: #3B82F6;       /* HR           ขาว-ฟ้า (Blue) */
  --mod-financial: #8B5CF6;/* Financial    ขาว-ม่วง (Purple) */
  --mod-maintenance: #0D9488; /* Maintenance ขาว-เขียวอมฟ้า (Teal) */
  --mod-sale: #EC4899;     /* Sale-Admin   ขาว-ชมพู (Magenta) */
  --mod-marketing: #F97316;/* Marketing    ขาว-ส้ม (Orange) */

  /* Active module color — Shell จะ set ค่านี้ตามโมดูลที่เปิดอยู่ */
  --module-color: var(--brand-green);
  --module-color-bg: #F3FBF1;
}
```

- ฟอนต์: **IBM Plex Sans Thai** (Google Fonts) น้ำหนัก 400/500/600/700
- ทุก component ใน shell อ้างอิงสีจาก variable เท่านั้น **ห้าม hardcode hex ใน component**

---

## 5. Database Schema (Prisma — schema `core`)

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["core"]
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  name         String
  avatarUrl    String?  @map("avatar_url")
  isActive     Boolean  @default(true) @map("is_active")
  failedLogins Int      @default(0) @map("failed_logins")
  lockedUntil  DateTime? @map("locked_until")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  roles         UserRole[]
  refreshTokens RefreshToken[]
  auditLogs     AuditLog[]

  @@map("users")
  @@schema("core")
}

model Role {
  id          String @id @default(uuid())
  code        String @unique          // SUPER_ADMIN, MANAGER, STAFF, ...
  name        String
  description String?

  users       UserRole[]
  permissions RolePermission[]

  @@map("roles")
  @@schema("core")
}

model Permission {
  id       String  @id @default(uuid())
  code     String  @unique            // เช่น 'hr.leave.approve' — Phase นี้ยังว่าง
  moduleId String? @map("module_id")

  module Module? @relation(fields: [moduleId], references: [id])
  roles  RolePermission[]

  @@map("permissions")
  @@schema("core")
}

model RolePermission {
  roleId       String @map("role_id")
  permissionId String @map("permission_id")

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@map("role_permissions")
  @@schema("core")
}

model UserRole {
  userId String @map("user_id")
  roleId String @map("role_id")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
  @@map("user_roles")
  @@schema("core")
}

model RefreshToken {
  id         String    @id @default(uuid())
  userId     String    @map("user_id")
  tokenHash  String    @unique @map("token_hash")   // เก็บ SHA-256 ของ token ไม่เก็บ raw
  deviceInfo String?   @map("device_info")
  expiresAt  DateTime  @map("expires_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("refresh_tokens")
  @@schema("core")
}

model Module {
  id        String  @id @default(uuid())
  code      String  @unique   // report_task, hr, financial, maintenance, sale_admin, marketing
  name      String
  color     String            // hex
  isEnabled Boolean @default(false) @map("is_enabled")  // Phase นี้ = false ทั้งหมด
  sortOrder Int     @default(0) @map("sort_order")

  permissions Permission[]

  @@map("modules")
  @@schema("core")
}

model AuditLog {
  id         String   @id @default(uuid())
  userId     String?  @map("user_id")
  module     String   @default("core")
  action     String                     // LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, TOKEN_REFRESH, ...
  targetId   String?  @map("target_id")
  ip         String?
  userAgent  String?  @map("user_agent")
  detail     Json?
  createdAt  DateTime @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id])

  @@index([userId, createdAt])
  @@map("audit_logs")
  @@schema("core")
}
```

---

## 6. Auth Flow

### 6.1 Login (`POST /api/auth/login`)
```
body: { email: string, password: string }   // validate ด้วย Zod
```
ลำดับการทำงาน:
1. Rate limit ที่ Redis: **สูงสุด 10 ครั้ง/นาที ต่อ IP** → เกิน = 429
2. หา user จาก email → ถ้าไม่พบ ตอบ 401 ข้อความกลาง ๆ ("อีเมลหรือรหัสผ่านไม่ถูกต้อง" — ห้ามบอกว่า email ไม่มีในระบบ)
3. ถ้า `lockedUntil > now` → 423 "บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง"
4. verify Argon2id → ผิด: `failedLogins + 1`, ถ้าครบ 5 ครั้ง set `lockedUntil = now + 15 นาที`, บันทึก AuditLog `LOGIN_FAILED`
5. ถูก: reset `failedLogins = 0`
6. สร้าง **Access Token** (JWT, อายุ 15 นาที) payload: `{ sub: userId, roles: string[], permissions: string[] }`
7. สร้าง **Refresh Token** (random 64 bytes) → เก็บ SHA-256 ลงตาราง `refresh_tokens` (อายุ 7 วัน)
8. Set cookies (ทั้งคู่ `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`):
   - `sb_access` = access token
   - `sb_refresh` = refresh token (Path=`/api/auth/refresh`)
9. บันทึก AuditLog `LOGIN_SUCCESS` (ip, userAgent)
10. ตอบ `{ user: { id, name, email, roles } }`

### 6.2 Refresh (`POST /api/auth/refresh`) — **Rotation**
1. อ่าน `sb_refresh` → hash → หาใน DB
2. ไม่พบ / หมดอายุ / `revokedAt != null` → **ถ้าเคยถูก revoke แล้วถูกใช้ซ้ำ = สัญญาณ token ถูกขโมย → revoke ทุก token ของ user นั้น** + AuditLog `TOKEN_REUSE_DETECTED` → 401
3. พบและ valid → revoke ตัวเก่า → ออก access + refresh ใหม่ (rotation) → set cookies ใหม่

### 6.3 Logout (`POST /api/auth/logout`)
- revoke refresh token ปัจจุบัน + ลบ cookies ทั้งสอง + AuditLog `LOGOUT`

### 6.4 Me (`GET /api/auth/me`)
- verify access token → ตอบ `{ user: { id, name, email, avatarUrl, roles, permissions } }`

### 6.5 Middleware (`apps/web/middleware.ts`)
- ทุก route ยกเว้น `/login`, `/api/auth/*`, `/_next/*`, static files:
  - ไม่มี/หมดอายุ `sb_access` → redirect `/login?next={pathname}`
- หลัง login สำเร็จ redirect กลับไปที่ `next` (validate ว่าเป็น relative path เท่านั้น กัน open redirect)

---

## 7. Module Registry (ว่าง — แต่โครงพร้อม)

`apps/web/module-registry.ts`:

```typescript
export interface ModuleMenuItem {
  label: string;
  path: string;
  permission: string;   // เมนูแสดงเมื่อ user มี permission นี้
  icon?: string;        // ชื่อ icon จาก lucide-react
}

export interface ModuleManifest {
  id: string;           // 'hr'
  name: string;         // 'ระบบบุคคล'
  color: string;        // '#3B82F6'
  colorBg: string;      // '#EFF5FF'
  basePath: string;     // '/hr'
  icon: string;
  menus: ModuleMenuItem[];
  permissions: string[];
}

/** Phase 1: ยังไม่มีโมดูลใด — ห้าม hardcode โมดูลที่นี่ */
export const moduleRegistry: ModuleManifest[] = [];

/** คืนเมนูเฉพาะที่ user มีสิทธิ์ — Sidebar เรียกใช้ฟังก์ชันนี้เท่านั้น */
export function getVisibleModules(userPermissions: string[]): ModuleManifest[] {
  return moduleRegistry
    .map((m) => ({
      ...m,
      menus: m.menus.filter((menu) => userPermissions.includes(menu.permission)),
    }))
    .filter((m) => m.menus.length > 0);
}
```

---

## 8. UI Spec

### 8.1 หน้า Login (`/login`)
- พื้นหลังขาว `--bg` ทั้งหน้า, การ์ดกลางจอกว้าง ~400px มีเงาอ่อน ขอบ `--line` โค้ง 16px
- ในการ์ด: โลโก้ **Smartboss** (คำว่า "Easy" สีเขียว `--brand-green`, "Boss" สี `--brand-navy`, ฟอนต์หนา) → หัวข้อ "เข้าสู่ระบบ" → ฟอร์ม
- ฟอร์ม: ช่อง email, ช่อง password (มีปุ่มตาแสดง/ซ่อน), ปุ่ม "เข้าสู่ระบบ" เต็มความกว้าง พื้น `--brand-green` ตัวอักษรขาว
- สถานะ: loading (ปุ่ม disabled + spinner), error แสดงข้อความจาก API ในกล่องแดงอ่อนเหนือปุ่ม
- ใต้การ์ด: แถบสีเล็ก ๆ 6 สีโมดูลเรียงกัน (เป็น brand element) + ข้อความ "© Smartboss"
- Responsive: มือถือการ์ดกว้าง 90vw
- ห้ามมีลิงก์ register / forgot password (แสดงข้อความ "ติดต่อผู้ดูแลระบบเพื่อขอบัญชี" ตัวเล็กสีเทาแทน)

### 8.2 Shell Layout (`(shell)/layout.tsx`)
- **Sidebar ซ้าย** กว้าง 260px พื้นขาว เส้นขวา `--line`:
  - บน: โลโก้ Smartboss
  - กลาง: เมนู "หน้าหลัก" (icon Home) + รายการโมดูลจาก `getVisibleModules()` — **Phase นี้จะว่าง** ให้แสดงข้อความเทาอ่อน "ยังไม่มีโมดูลที่เปิดใช้งาน"
  - ล่าง: ชื่อผู้ใช้ + role + ปุ่ม logout
  - มือถือ: ยุบเป็น hamburger + drawer
- **Topbar** สูง 60px: breadcrumb ซ้าย / ขวาเป็น avatar + dropdown (โปรไฟล์, ออกจากระบบ)
- Content area พื้น `--bg-soft` padding 24px

### 8.3 หน้า Home (`(shell)/page.tsx`)
- ทักทาย: "สวัสดี, {ชื่อ}" + วันที่ภาษาไทย
- Grid card 6 ใบ (responsive 1/2/3 คอลัมน์) การ์ดละโมดูล:
  - แถบสีบนการ์ด/ไอคอนใช้สีโมดูลนั้น, ชื่อโมดูล, คำอธิบายสั้น 1 บรรทัด
  - badge "เร็ว ๆ นี้" (Coming Soon) — การ์ดกดไม่ได้, opacity ปกติแต่ cursor ปกติ
  - ข้อมูล 6 โมดูล: Report-Task/รายงานและงาน, HR/ระบบบุคคล, Financial/การเงิน, Maintenance/แจ้งซ่อมบำรุง, Sale-Admin/งานขาย, Marketing/การตลาด — สีตามข้อ 4

---

## 9. Security Requirements (Definition of Secure)

1. รหัสผ่าน hash ด้วย **Argon2id** (memoryCost 19456, timeCost 2, parallelism 1)
2. JWT sign ด้วย **HS256 + secret จาก ENV ≥ 32 ตัวอักษร** (`JWT_SECRET`) — ห้าม hardcode
3. Cookies: `httpOnly + Secure + SameSite=Lax` ทั้งหมด (dev อนุโลม Secure=false ผ่าน ENV)
4. Refresh token เก็บเป็น **SHA-256 hash** ใน DB เท่านั้น
5. Rate limit `/api/auth/login` ที่ Redis
6. Zod validate ทุก input — payload ผิดรูปตอบ 400 พร้อมรายละเอียด field
7. Error ตอบกลับห้ามรั่ว stack trace / ข้อมูลภายใน
8. AuditLog ทุก event: LOGIN_SUCCESS, LOGIN_FAILED, ACCOUNT_LOCKED, LOGOUT, TOKEN_REFRESH, TOKEN_REUSE_DETECTED
9. Security headers ใน `next.config`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
10. `.env` อยู่ใน `.gitignore` และมี `.env.example` ครบทุก key

### ENV ที่ต้องมี (`.env.example`)
```
DATABASE_URL=postgresql://smartboss:smartboss@localhost:5432/smartboss
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-to-a-random-string-at-least-32-chars
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
COOKIE_SECURE=false
```

---

## 10. Seed Data (`packages/database/seed.ts`)

1. **Roles ทั้ง 8:** `SUPER_ADMIN`, `MANAGER`, `HR_OFFICER`, `ACCOUNTANT`, `SALE_ADMIN`, `MARKETING`, `TECHNICIAN`, `STAFF`
2. **Modules ทั้ง 6** (is_enabled = `false` ทุกตัว):

| code | name | color | sortOrder |
|---|---|---|---|
| report_task | รายงานและงาน | #64748B | 1 |
| hr | ระบบบุคคล | #3B82F6 | 2 |
| financial | การเงิน | #8B5CF6 | 3 |
| maintenance | แจ้งซ่อมบำรุง | #0D9488 | 4 |
| sale_admin | งานขาย | #EC4899 | 5 |
| marketing | การตลาด | #F97316 | 6 |

3. **ผู้ใช้ทดสอบ 2 คน:**
   - `admin@smartboss.app` / รหัสจาก ENV `SEED_ADMIN_PASSWORD` → role SUPER_ADMIN
   - `staff@smartboss.app` / รหัสจาก ENV `SEED_STAFF_PASSWORD` → role STAFF

---

## 11. Acceptance Criteria (Definition of Done)

- [ ] `docker compose up -d` แล้ว `pnpm db:migrate && pnpm db:seed && pnpm dev` รันได้ในคำสั่งเดียวต่อขั้น
- [ ] เข้า `/` โดยไม่ login → ถูก redirect ไป `/login`
- [ ] login ด้วย admin@smartboss.app สำเร็จ → เข้าหน้า Home เห็นคำทักทาย + card 6 โมดูล "เร็ว ๆ นี้" ครบทุกสี
- [ ] login ผิด 5 ครั้ง → บัญชีล็อก 15 นาที + มี AuditLog `ACCOUNT_LOCKED`
- [ ] Access token หมดอายุ (15 นาที) → ระบบ refresh ให้อัตโนมัติโดยผู้ใช้ไม่รู้สึก
- [ ] ใช้ refresh token ที่ถูก revoke แล้ว → ทุก session ของ user ถูกตัด + AuditLog `TOKEN_REUSE_DETECTED`
- [ ] logout → กด back กลับมาไม่เห็นหน้า Home (ถูกดีดไป login)
- [ ] Sidebar แสดง "ยังไม่มีโมดูลที่เปิดใช้งาน" (registry ว่าง)
- [ ] มือถือ (375px): Sidebar ยุบเป็น drawer, หน้า login แสดงถูกต้อง
- [ ] ไม่มี hex color hardcode ใน component (ยกเว้น tokens.css)
- [ ] `pnpm lint && pnpm typecheck` ผ่านทั้งหมด

---

## 12. Workflow — ลำดับการลงมือ

```
STEP 1  ตั้ง Monorepo
        turborepo + pnpm + apps/web (create-next-app) + packages ทั้ง 4
        docker-compose.yml (postgres:16, redis:7) → docker compose up -d

STEP 2  Design Tokens + Font
        packages/ui/tokens.css + IBM Plex Sans Thai ใน root layout
        ทดสอบ: หน้าเปล่าแสดงฟอนต์ไทยถูกต้อง

STEP 3  Database
        เขียน schema.prisma (ข้อ 5) → pnpm db:migrate → เขียน seed.ts → pnpm db:seed
        ทดสอบ: เปิด Prisma Studio เห็น 8 roles, 6 modules, 2 users

STEP 4  packages/auth
        jwt.ts → refresh.ts → session.ts → guard.ts (เขียน unit test สั้น ๆ ของ jwt sign/verify)

STEP 5  Auth API ทั้ง 4 เส้น
        login → refresh → logout → me (+ rate limit + audit log)
        ทดสอบ: ยิงผ่าน REST client ครบทุก case ในข้อ 6

STEP 6  Middleware
        ป้องกันทุก route → ทดสอบ redirect ทั้งขาเข้าและ ?next=

STEP 7  หน้า Login UI
        ตาม spec 8.1 → ต่อกับ API จริง → ทดสอบ error states ทั้งหมด

STEP 8  Shell Layout + Module Registry
        module-registry.ts (ว่าง) → Sidebar + Topbar ตาม spec 8.2

STEP 9  หน้า Home
        card 6 โมดูลตาม spec 8.3

STEP 10 ตรวจ Acceptance Criteria ข้อ 11 ทีละข้อ → แก้จนครบ
```

> **หลักการทำงาน:** ทำทีละ STEP และทดสอบให้ผ่านก่อนไป STEP ถัดไป — ห้ามข้ามขั้น เพราะทุก Phase ถัดไป (การเสียบโมดูลทั้ง 6) จะยืนอยู่บนโครงนี้ทั้งหมด
