# Changelog

**อ่านไฟล์นี้ก่อนเริ่มงานทุกครั้งที่ pull code ใหม่มา** — เพื่อให้รู้ว่าใครแก้อะไรไป
ต้องทำอะไรต่อ (migration/seed/deploy) และมีอะไรที่ยังค้างอยู่บ้าง

## วิธีเพิ่มรายการ

แก้โค้ดเสร็จ (commit แล้ว) ให้เพิ่มบล็อกใหม่ไว้ **บนสุด** ของหัวข้อ "## บันทึก" ด้านล่าง
ตามฟอร์แมตนี้:

```
### YYYY-MM-DD HH:MM — <ชื่อคุณ>
**<feat/fix/docs>:** <สรุปสั้น ๆ ว่าทำอะไร>
- ทำอะไร: <รายละเอียดพอเข้าใจ ไม่ต้องยาว>
- ไฟล์/branch หลัก: <ไฟล์หรือโฟลเดอร์สำคัญ>
- ต้องทำหลัง pull: <migration/seed/deploy ที่ต้องรัน หรือเขียน "ไม่มี">
- ค้างอยู่ / ต้องระวัง: <ถ้ามี>
```

ใช้เวลาปัจจุบันจริง (เขตเวลาไทย) — จะเอามาจาก `git log -1 --date=format:'%Y-%m-%d %H:%M'` ของ
commit ที่เพิ่งทำก็ได้ ไม่ต้องเดา

---

## บันทึก

### 2026-08-12 11:22 — baanpoolvilla (แก้ร่วมกับ Claude)
**fix:** ความยาวรหัสผ่านขั้นต่ำในฟอร์มไม่ตรงกับที่ตรวจจริง ทำหน้า error ตอนสร้าง/รีเซ็ตรหัสผ่าน
- ทำอะไร: หลัง commit `cdd52b7` ของ katawutntp (ค่าเริ่มต้นความยาวรหัสผ่านขยับจาก 8 เป็น 12
  ตัวอักษร ตั้งได้รายบริษัทที่ `/admin/security`) มี 3 ฟอร์มที่ยังเขียน `minLength`/ข้อความ hint
  ตายตัวเป็นเลขเก่า ไม่ตรงกับที่ server ตรวจจริง — กรอกตามที่ฟอร์มบอกว่าพอ แล้วโดนปฏิเสธฝั่ง
  เซิร์ฟเวอร์ กลายเป็นหน้า "This page couldn't load" (server action ไม่มี error boundary จับ)
- ไฟล์หลัก: `apps/web/app/(shell)/account/page.tsx`,
  `apps/web/app/(shell)/admin/users/new/page.tsx`,
  `apps/web/app/(shell)/admin/users/[id]/page.tsx`
- ต้องทำหลัง pull: ไม่มี (ไม่มี migration ใหม่ — แค่ build ใหม่ผ่าน `deploy/release.sh`)
- ค้างอยู่ / ต้องระวัง: ไม่มี

### 2026-08-12 10:54 — katawutntp
**feat:** นโยบายล็อกบัญชีและความยาวรหัสผ่านตั้งได้รายบริษัท
- ทำอะไร: เดิม `MAX_FAILED_LOGINS=5`, `LOCK_MINUTES=15`, ความยาวรหัสผ่านขั้นต่ำ เป็นค่าตายตัวในโค้ด
  บังคับทุกบริษัทเหมือนกัน — ย้ายมาตั้งได้ต่อบริษัทที่หน้า `/admin/security` ใหม่ พร้อมปุ่มปลดล็อก
  บัญชีในหน้าผู้ใช้ (มี audit ว่าใครปลดให้ใคร) และข้อความตอนโดนล็อกบอกเวลาที่เหลือ
- ไฟล์/ตารางหลัก: `core.security_settings` (ตารางใหม่), `apps/web/lib/security-settings.ts`,
  `/admin/security`, permission `core.security.setting.manage`
- ต้องทำหลัง pull: **มี migration ใหม่** — รัน `pnpm db:deploy` ก่อน `deploy/release.sh`
- ค้างอยู่ / ต้องระวัง: ค่าเริ่มต้นความยาวรหัสผ่านขยับจาก 8 → 12 ตัวอักษร — ดูรายการถัดขึ้นไป
  (บันทึก 11:22) ที่แก้ฟอร์มที่ยังพังเพราะเรื่องนี้

### 2026-08-12 10:04 — baanpoolvilla (ทำร่วมกับ Claude, Phase 3/3)
**feat:** report_task ดึงแผนก/ตำแหน่งจาก core แทนของในตัวเองแล้ว
- ทำอะไร: จบชุดงาน "แผนก+ตำแหน่งเป็นของกลาง" — โมดูล report_task เลิกเก็บแผนก/ตำแหน่งของตัวเอง
  หันไปอ่านจาก `core.departments`/`core.users.position` (สร้าง/แก้ผ่าน `/admin` แล้ว) แทน
  สร้าง user ที่ `/admin` แล้วแผนก/ตำแหน่งขึ้นในโมดูลนี้ทันที ไม่ต้องตั้งซ้ำ — สี/หัวหน้าแผนก
  ยังเป็นของโมดูลนี้เอง (ไม่ใช่แนวคิดร่วมข้ามโมดูล) เก็บทับไว้แยกต่างหาก
- ไฟล์หลัก: `apps/web/modules/report_task/lib/db/departments.ts` (ใหม่),
  `lib/db/employee-directory.ts`, `store/department-store.ts`,
  `components/shared/org-settings-panel.tsx`, `app/api/report-task/store/[key]/route.ts`
- ต้องทำหลัง pull: ไม่มี (schema มาจาก Phase 1 แล้ว)
- ค้างอยู่ / ต้องระวัง: ยังไม่ได้ทดสอบ end-to-end เต็มรูปแบบบน production (สร้างแผนก →
  assign user → เช็คว่าขึ้นในบอร์ด Kanban/ตั้งค่า report-task ถูกต้อง)

### 2026-08-12 09:46 — baanpoolvilla (ทำร่วมกับ Claude, Phase 2/3)
**feat:** หน้าจัดการแผนก/ตำแหน่ง + สิทธิ์ระดับแผนก/ตำแหน่งข้ามทุกโมดูล
- ทำอะไร: เพิ่มหน้า `/admin/departments`, `/admin/positions` (สร้าง/แก้/ลบ + ตาราง permission
  matrix เหมือน `/admin/roles`) และช่องตั้งแผนก/ตำแหน่งของ user ที่ `/admin/users/[id]` —
  สิทธิ์ที่แผนก/ตำแหน่งกำหนดจะรวมกับสิทธิ์ตาม role ของแต่ละคนตอน login
- ไฟล์หลัก: `apps/web/app/(shell)/admin/departments/*`, `admin/positions/*`,
  `apps/web/modules/admin/data/departments.ts`, `data/positions.ts`,
  `packages/auth/user.ts` (รวมสิทธิ์จาก department/position เข้า JWT)
- ต้องทำหลัง pull: รัน `pnpm db:seed` (idempotent) เพื่อเติม permission
  `core.department.*`/`core.position.*` เข้าแคตตาล็อกที่มีอยู่แล้ว
- ค้างอยู่ / ต้องระวัง: ไม่มี

### 2026-08-12 09:33 — baanpoolvilla (ทำร่วมกับ Claude, Phase 1/3)
**feat:** เพิ่ม Department + Position เป็นของกลาง พร้อมสิทธิ์ระดับแผนก/ตำแหน่ง
- ทำอะไร: เพิ่มตาราง `core.departments`, `core.positions`, `core.department_permissions`,
  `core.position_permissions` และคอลัมน์ `users.department_id`/`users.position_id` — จุดเริ่มของ
  ชุดงาน "แผนก+ตำแหน่งไม่ต้องตั้งซ้ำทีละโมดูล" (จบครบที่บันทึก 10:04 ด้านบน)
- ไฟล์หลัก: `packages/database/prisma/schema/core.prisma`,
  migration `20260812100000_add_departments_positions`
- ต้องทำหลัง pull: **มี migration ใหม่** — รัน `pnpm db:deploy`
- ค้างอยู่ / ต้องระวัง: migration เขียนมือ (ไม่มี DB ต่อตอนเขียนให้ `prisma migrate dev` diff ให้)
  แต่ยืนยันแล้วว่า apply ผ่านจริงบน production ไม่มี drift
