# คะแนนผลงานรายคน (KPI ข้ามโมดูล)

หน้า `/admin/performance` ตอบคำถามเดียวที่ระบบนี้ถูกสร้างมาเพื่อมัน — **เดือนนี้แต่ละคน
ทำงานเป็นอย่างไร** โดยไม่ต้องไล่เปิดทีละโมดูล

## แนวคิด

เก็บเป็น **เหตุการณ์** ไม่ใช่ยอดสะสม (`core.performance_events`) คะแนนรวมคำนวณใหม่
ทุกครั้งที่เปิดหน้า จึงย้อนดูที่มาได้ทุกแต้ม และแก้ย้อนหลังได้เมื่อข้อมูลผิด

กันหักซ้ำด้วย unique `(org_id, source, category, ref_type, ref_id)` — **สำคัญมาก**
เพราะตัวกวาดรันซ้ำได้ตลอด ถ้าไม่มีตัวนี้ ใบงานใบเดียวจะโดนหักทุกรอบ

`occurred_at` ของงานที่ปล่อยค้างใช้ **วันที่ตรวจพบ** ไม่ใช่วันครบกำหนด — ถ้าใช้วัน
ครบกำหนด งานที่ค้างเกินช่วงรายงานจะหลุดออกไป กลายเป็นยิ่งปล่อยนานยิ่งไม่โดนหัก

## แหล่งเหตุการณ์

| source | category | ที่มา |
| --- | --- | --- |
| `report_task` | `task_late`, `task_manual_dock`, `report_missed`, `report_late` | บอร์ดงาน/ฟีดรายงาน |
| `maintenance` | `workorder_overdue`, `pm_missed` | `dockOverdueMaintenance()` |
| `workforce` | `attendance_late`, `attendance_absent` | `dockAttendance()` |

ทั้งสองตัวหลังเรียกจาก `GET /api/cron/maintenance?task=performance`
(ตั้ง `CRON_SECRET` บน production — ถ้าไม่ตั้ง route จะตอบ 503 ไม่ใช่เปิดโล่ง)

## ⚠ ไม่มีตัวเลขฝังในโค้ด

ทุกค่าที่ตัดสินว่า "ดีหรือไม่ดี" อยู่ใน `core.performance_settings` **รายบริษัท**
แก้ผ่าน `/admin/performance/settings` (สิทธิ์ `core.performance.setting.manage`)

| ฟิลด์ | ความหมาย | ค่าเริ่มต้น |
| --- | --- | --- |
| `enabled` | ปิด = ไม่บันทึกเหตุการณ์ใหม่ ข้อมูลเดิมยังอยู่ | `true` |
| `base_score` | คะแนนตั้งต้นของทุกคน | 100 |
| `late_threshold_minutes` | สายเกินกี่นาทีถึงนับ | 15 |
| `absence_threshold_minutes` | ขาดเกินกี่นาทีถึงนับ | 240 |
| `pm_grace_days` | PM เลยกำหนดเกินกี่วันถึงถือว่าปล่อยปละละเลย | 7 |
| `attendance_lookback_days` | แต่ละรอบกวาด มองย้อนหลังกี่วัน | 45 |
| `rule_points` | คะแนนหักต่อชนิดเหตุการณ์ (jsonb) | ดู `DEFAULT_RULE_POINTS` |
| `grade_thresholds` | คะแนนขั้นต่ำของแต่ละเกรด (jsonb) | A90 B80 C70 D60 |

**ห้ามอ่าน `DEFAULT_*` ใน [`apps/web/lib/performance.ts`](../apps/web/lib/performance.ts)
ไปใช้ตรง ๆ** ให้เรียก `loadPerformanceSettings(orgId)` เสมอ — ค่าเหล่านั้นเป็นแค่
ค่าตั้งต้นของบริษัทที่ยังไม่เคยตั้ง

`rule_points` ที่บันทึกไว้ทับ **เฉพาะคีย์ที่ระบุ** เหตุการณ์ชนิดใหม่ที่เพิ่มทีหลัง
จึงใช้ค่าเริ่มต้นได้ทันที ไม่ต้องให้ทุกบริษัทกลับมาตั้งใหม่

ชื่อเกรดตั้งเองได้ (A–F, ผ่าน/ไม่ผ่าน, ดีมาก/ดี/พอใช้) หน้าจอจึงเลือกสีจาก **อันดับ**
ไม่ใช่ตัวอักษร — ถ้าผูกสีกับ "A" ตายตัว เกรดที่ตั้งชื่อเองจะไม่มีสี

การแก้เกณฑ์ **ไม่ย้อนไปแก้เหตุการณ์เดิม** (`points` ถูกตรึงไว้ตอนบันทึก) ตั้งใจให้เป็น
อย่างนั้น ไม่งั้นการปรับเกณฑ์วันนี้จะเปลี่ยนคะแนนย้อนหลังของทุกคนโดยไม่มีใครรู้ตัว

## กับดักที่เจอแล้ว

ตาราง `workforce.*` เปิด FORCE RLS ทุกใบ Prisma ต่อด้วย user ที่ไม่มี tenant context
จึงอ่านได้ **0 แถวเสมอโดยไม่มี error** — `dockAttendance()` ต้องอ่านผ่าน
`workforce.performance_attendance()` (SECURITY DEFINER เจ้าของ `workforce_lookup`)
ติดตั้งด้วย `packages/workforce/db/sql/04-performance-lookup.sql` ซึ่งมีตัวตรวจเจ้าของ
ในตัว ถ้าเจ้าของผิดจะ RAISE EXCEPTION ทันทีแทนที่จะเงียบ

ตัวกวาดวิ่งข้ามบริษัท จึง query ด้วยเกณฑ์ที่ "หลวมที่สุด" ในบรรดาบริษัททั้งหมด
(`Math.min` ของ threshold, `Math.max` ของ lookback) แล้วค่อยกรองรายบริษัทอีกที
ในโค้ด — ไม่ใช่ยิงทีละบริษัท

## สิทธิ์

| code | ให้ใคร (ตอน seed) |
| --- | --- |
| `core.performance.view` | ADMIN, CEO, MANAGER |
| `core.performance.setting.manage` | ADMIN, CEO |

MANAGER ตั้งเกณฑ์ไม่ได้โดยตั้งใจ — ไม่งั้นหัวหน้าแก้เกณฑ์ให้ทีมตัวเองดูดีได้

SUPER_ADMIN ผ่านได้ทั้งสองตัวโดยไม่ต้องถือจริง (ดู `packages/auth/permissions.ts`)
