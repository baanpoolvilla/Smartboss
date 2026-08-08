# โมดูล "แจ้งซ่อมบำรุง" (Maintenance) — เอกสารวิเคราะห์ + ออกแบบ DB + แผน Port

> ที่มา: `แจ้งซ่อมบำรุง_module/changyai/baanpool-ops` — แอป Flutter (ชื่อภายใน **ChangYai — Property Operations**)
> Backend เดิม: **Supabase** (Postgres + Auth + Storage + 57 SQL migrations พร้อม RLS/trigger/RPC)
> เป้าหมาย: port มาเป็นโมดูล `maintenance` ของ Smartboss (Next.js + Prisma + Postgres) **ฟีเจอร์เหมือนเดิมทุกอย่าง** + multi-tenant (รองรับหลายบริษัท) + คิดเผื่อสเกล

---

## 1. ระบบนี้คืออะไร (สรุป)

ระบบบริหารงานซ่อมบำรุง/ปฏิบัติการทรัพย์สินหลายหลัง (บ้าน/สถานที่) ครบวงจร:
- แจ้งงานซ่อม (Work Order) พร้อมรูปก่อน/หลัง คอมเมนต์ มอบหมายช่าง แนบหลายบ้าน
- แผนบำรุงรักษาเชิงป้องกัน (PM) 3 โหมด + สร้างใบงานอัตโนมัติเมื่อถึงกำหนด
- ค่าใช้จ่าย (Expense) แยกประเภท/ผู้รับผิดชอบ + รายงาน + ส่งออก CSV
- ใบขอซื้อ→ใบสั่งซื้อ (PR→PO) พร้อมสายอนุมัติจาก CEO
- ช่างภายนอก/ผู้รับเหมา (Contractor) + ประวัติงาน + เรตติ้ง
- แจ้งเตือนในแอป + LINE Notify + ลิงก์อัปโหลดรูปสาธารณะสำหรับช่างนอก
- แดชบอร์ด + จัดการผู้ใช้/บทบาท + LINE log

**บทบาท (roles):** `admin`(Super Admin) · `owner`(CEO) · `manager`(ผู้จัดการ) · `caretaker`(ผู้ดูแลบ้าน) · `technician`(ช่าง)
การมองเห็นข้อมูลเป็นแบบ **row-level ตามการมอบหมาย**: ช่างเห็นเฉพาะงานตัวเอง, ผู้ดูแลบ้านเห็นเฉพาะบ้านที่ดูแล, manager+ เห็นทุกอย่าง

---

## 2. คลังตาราง/เอนทิตี (สภาพสุดท้ายหลังรวมทุก migration)

| # | ตารางเดิม (Supabase) | สาระสำคัญ | หมายเหตุ port |
|---|---|---|---|
| 1 | `users` | owner/manager/technician/caretaker/admin + `line_user_id`, phone | ← ใช้ `core.users` ของ Smartboss + เพิ่ม `line_user_id` |
| 2 | `properties` | บ้าน/ทรัพย์สิน: name, address, owner_name/contact, notes, `caretaker_id`, category | ตารางใหม่ใน schema `maintenance` |
| 3 | `property_categories` | prefix → display_name (จัดหมวดจากคำนำหน้าชื่อบ้าน) | ตารางใหม่ |
| 4 | `assets` | อุปกรณ์: property_id, name, category, brand, model, install/warranty date, notes, image_url | ตารางใหม่ |
| 5 | `work_orders` | ใบงาน: property/asset/assigned_to/created_by, title, desc, status, priority, due/completed, completion_notes, photo_urls[], after_photo_urls[], cc_user_ids[], additional_property_ids[], pm_schedule_id(+ids[]), auto_created | ตารางหลัก |
| 6 | `work_order_comments` | คอมเมนต์ใบงาน + รูป | ตารางใหม่ |
| 7 | `work_order_external_photos` + upload links | รูปจากช่างนอกผ่าน token สาธารณะ (RPC) | ตาราง + token flow |
| 8 | `expenses` | ค่าใช้จ่าย: ผูก WO/PM/PO/property, amount, category, receipt, billable_to_partner, cost_type(work_order/pm), paid_by(company/owner), is_no_expense | ตารางใหม่ |
| 9 | `pm_schedules` | แผน PM: frequency, next_due, `anchor_date`, `rounds_per_year`, `total_rounds`, `rounds_done`, `awaiting_schedule`, is_active, assigned_to, cc_user_ids[] | ตรรกะซับซ้อน (ดูข้อ 4) |
| 10 | `contractors` | ผู้รับเหมา: specialty, company, zone, rating, is_active, price, category | ตารางใหม่ |
| 11 | `contractor_history` | ประวัติงานผู้รับเหมา + เรตติ้ง | ตารางใหม่ |
| 12 | `purchase_orders` | PR→PO: status(pending/approved/ordered/received/cancelled), items(jsonb), total_price, receipt/pr images[], is_self/emergency_purchase, po_assigned_to | ตารางหลัก |
| 13 | `purchase_order_comments` | คอมเมนต์ PO + รูป | ตารางใหม่ |
| 14 | `notifications` | แจ้งเตือนในแอป: user_id, title, body, type, reference_id, read_at | → `core` (ใช้ข้ามโมดูลได้) |
| 15 | `line_notification_logs` | log การส่ง LINE | ตารางใหม่ (audit) |

**ENUM / สถานะสำคัญ**
- WorkOrder.status: `open | in_progress | completed | cancelled`; priority: `low | medium | high | urgent`
- PO.status: `pending(รอ CEO) | approved | ordered | received | cancelled`
- Expense.cost_type: `work_order | pm`; paid_by: `company | owner`
- PM.frequency: weekly/biweekly/triweekly + monthly..annual (แอปแม็พเป็น week1-3, month1-12)

---

## 3. ออกแบบ DB ใหม่ให้เข้ากับ Smartboss

**หลักการ**
1. **แยก schema:** ใส่ตารางทั้งหมดใน Postgres schema ใหม่ชื่อ `maintenance` (Prisma multiSchema) — `core` เดิมไม่แตะ ยกเว้นเพิ่ม `users.line_user_id` และตาราง `notifications` กลาง
2. **Multi-tenant:** ทุกตารางมี `org_id` (บริษัทลูกค้า) + index — ของเดิมเป็น single-tenant ต้องเติม org_id ให้ทุกแถว และ data layer กรอง org_id เสมอ (ตาม pattern โมดูล Smartboss)
3. **อ้างอิงผู้ใช้:** `assigned_to / created_by / caretaker_id / cc_user_ids[]` ชี้ไป `core.users.id` (เก็บเป็น UUID string แบบ loose coupling เหมือนของเดิมที่ join เอง) — ความสัมพันธ์ภายใน maintenance (property→asset→work_order) เป็น FK จริง
4. **RBAC:** แม็พบทบาทเดิม→บทบาท+permission ของ Smartboss (ดูข้อ 5) ส่วนการมองเห็นแบบ row-level (ช่างเห็นงานตัวเอง/ผู้ดูแลเห็นบ้านตัวเอง) ทำที่ data layer ด้วย session.userId + role

**Prisma models (สรุป, schema `maintenance`, ทุกตัวมี `orgId`)**
`Property, PropertyCategory, Asset, WorkOrder, WorkOrderComment, WorkOrderExternalPhoto, WorkOrderUploadLink, Expense, PmSchedule, Contractor, ContractorHistory, PurchaseOrder, PurchaseOrderComment` + `core.Notification`, `maintenance.LineNotificationLog`

---

## 4. ตรรกะสำคัญที่ต้อง port ให้ตรง (ห้ามพลาด)

- **PM 3 โหมด** (จาก `pm_schedule.dart` + `supabase_service.dart`):
  - `continuous` — ทำทุก N เดือน/สัปดาห์ไปเรื่อย ๆ
  - `yearlyRounds` — ทำ N รอบ/ปีแล้วเว้นยาว วนกลับวันเดิมปีถัดไป (เช่น ล้างแอร์)
  - `limitedCount` — ทำครบ N ครั้งแล้วจบ นัดวันทีละครั้ง (เช่น ฉีดปลวก) → มี `awaiting_schedule`, `rounds_done`, ปิด PM อัตโนมัติเมื่อครบ
  - **การคำนวณ next_due ยึด `anchor_date`** ไม่ให้ดริฟต์ตามวันจบงาน (ฟังก์ชัน `nextDueSlot`, `_addMonthsClamped` — ต้อง port แบบ 1:1 พร้อม unit test)
- **PM เสร็จ → เลื่อนรอบ / นับครั้ง / ปิดสัญญา** (`completePmScheduleById`)
- **สร้างใบงานอัตโนมัติจาก PM ที่ถึงกำหนด** (เดิมเป็น trigger/RPC + digest notify) → ย้ายเป็น **cron job** ฝั่งแอป
- **PR→PO flow** + สิทธิ์อนุมัติเฉพาะ CEO
- **External upload token** (สร้างลิงก์ revoke ของเก่า, อัปโหลดรูปโดยไม่ต้อง login)
- **LINE Notify** เมื่อ: มอบหมายงาน, คอมเมนต์, เปลี่ยนสถานะ PO, PM ใกล้ครบ (เดิมอยู่ใน SQL trigger → ย้ายเป็น notification service ฝั่งแอป)

---

## 5. แม็พบทบาท → Smartboss RBAC

| เดิม | Smartboss role | permission หลัก |
|---|---|---|
| admin (Super Admin) | `SUPER_ADMIN` | ทุกอย่าง (bypass) |
| owner (CEO) | `CEO` *(เพิ่มใหม่)* | อนุมัติ PO, เห็นทุกอย่าง |
| manager | `MANAGER` | จัดการทุกส่วน ยกเว้นอนุมัติ PO |
| caretaker (ผู้ดูแลบ้าน) | `CARETAKER` *(เพิ่มใหม่)* | จัดการบ้านที่ดูแล + asset + PM |
| technician (ช่าง) | `TECHNICIAN` | เห็น/อัปเดตเฉพาะงานที่ได้รับ |

**Permission codes (ร่าง):** `maintenance.workorder.{view,create,update,complete,delete}`, `maintenance.expense.manage`, `maintenance.po.{create,approve}`, `maintenance.pm.manage`, `maintenance.property.manage`, `maintenance.asset.manage`, `maintenance.contractor.manage`, `maintenance.admin`

---

## 6. การตัดสินใจเรื่อง integration

| หัวข้อ | เดิม | แผน port | เหตุผล |
|---|---|---|---|
| Auth | LINE Login + email | ใช้ auth Smartboss (email/JWT); ผูก `line_user_id` ไว้เพื่อ "ส่ง" LINE เท่านั้น | ระบบเดียวกัน ลดความซับซ้อน |
| แจ้งเตือน LINE (ขาออก) | LINE Messaging push | **คงไว้** เป็น service ในโมดูล (ต้องมี LINE_MESSAGING_TOKEN) | เป็นหัวใจ ops |
| ไฟล์/รูป | Supabase Storage bucket `photos` | **S3-compatible** (MinIO ตอน dev / R2 หรือ S3 ตอน prod) ผ่าน abstraction | รันบนเซิร์ฟเวอร์เช่าเองได้ สเกลได้ |
| Trigger/RPC ใน DB (LINE/auto-WO/digest) | 57 migrations SQL | ย้ายมาเป็น **app logic + cron job** | ดูแล/ทดสอบง่ายในสแตก Smartboss |

---

## 7. แผน Port แบบเป็นเฟส (ตรวจทีละเฟส)

- **M0 — รากฐาน:** schema `maintenance` (ทุกตาราง + org_id) + migrate + ลงทะเบียนโมดูลใน registry + seed (module catalog + permissions + roles CEO/CARETAKER + subscribe demo org) + หน้าเปล่า
- **M1 — Properties + Assets:** CRUD list/detail/form, categories, caretaker (master data)
- **M2 — Work Orders:** list/detail/form, filters, comments, รูปก่อน/หลัง, status, completion, CC, หลายบ้าน (หัวใจ)
- **M3 — Expenses:** list/form/report/quick, cost_type, paid_by, CSV export
- **M4 — PM Schedules:** 3 โหมด + anchor calc + complete→advance + equipment overview + cron auto-WO
- **M5 — Contractors + Purchase Orders:** contractor+history, PR→PO flow + comments
- **M6 — Notifications + LINE + Admin + External upload + Dashboard**
- **M7 — Storage abstraction, cron jobs, polish, ตรวจ parity 1:1 กับของเดิม**

> แต่ละเฟสจบด้วย: typecheck ผ่าน + ทดสอบ flow จริง + org isolation ยังกันได้

---

## 8. คำถาม/decision ที่ต้องยืนยันก่อนเริ่ม M0
1. **Storage:** ใช้ S3-compatible (แนะนำ) หรือ local disk ไปก่อน?
2. **LINE Notify:** คงไว้ไหม (ต้องมี token)? LINE login ตัดทิ้งโอเคไหม?
3. **ลำดับเฟส:** เริ่ม M0 (DB) เลย แล้วไล่ M1→M6 ตามนี้โอเคไหม? มีฟีเจอร์ไหนอยากได้ก่อน?
