-- ═══════════════════════════════════════════════════════════════════════
-- กติกาใหม่: "ทุกคนเห็นและเข้าถึงได้ทุกโมดูล แต่สิทธิ์การใช้งานในแต่ละโมดูลต่างกัน"
--
-- defaults.ts (BASELINE_PERMS) ทำให้บริษัทที่ **สร้างใหม่** ได้กติกานี้แล้ว
-- migration นี้คือส่วนที่ทำให้บริษัทและบทบาทที่ **มีอยู่แล้ว** ได้เหมือนกัน —
-- ถ้าไม่มี ระบบจริงจะยังเป็นแบบเดิม (STAFF/SALE_ADMIN/MARKETING/ACCOUNTANT
-- ล็อกอินเข้ามาแล้วไม่เห็นโมดูลอะไรเลย) โดยไม่มี error ให้เห็น
--
-- ⚠ ไฟล์นี้ทำแค่ "สิทธิ์พื้นฐาน + สิทธิ์รายงานและงาน" เท่านั้น การไล่มอบสิทธิ์
-- ตาม ROLE_GRANTS ให้ครบทุกบทบาทของบริษัทเก่า อยู่ที่
-- scripts/backfill-role-grants.ts — จงใจไม่เอามาเขียนซ้ำเป็น SQL ที่นี่
-- เพราะจะกลายเป็นตารางสิทธิ์ชุดที่สองที่วันหนึ่งไม่ตรงกับ defaults.ts
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1) ลงแคตตาล็อกสิทธิ์ของโมดูลรายงานและงาน ──────────────────────────
-- ชุดนี้ตกหล่นมาตั้งแต่โมดูลถูกพอร์ตเข้ามา (seed.ts ลงแค่ core/hr/maintenance/
-- example/chat) ผลคือหน้า /admin/roles ไม่เคยมีสิทธิ์กลุ่มนี้ให้ติ๊กเลย และ
-- มีแต่ SUPER_ADMIN ที่เห็นโมดูลนี้ได้เพราะ resolvePermission ปล่อยผ่านให้
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT
  gen_random_uuid()::text,
  c."code",
  (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'report_task')
FROM (VALUES
  ('report_task.access'),
  ('report_task.task.view'),
  ('report_task.task.manage'),
  ('report_task.calendar.view'),
  ('report_task.calendar.manage'),
  ('report_task.report.view'),
  ('report_task.report.submit'),
  ('report_task.report.manage'),
  ('report_task.activity.view'),
  ('report_task.issue.view'),
  ('report_task.issue.manage'),
  ('report_task.setting.manage')
) AS c("code")
ON CONFLICT ("code") DO UPDATE
  SET "module_id" = EXCLUDED."module_id";

-- ── 2) มอบสิทธิ์พื้นฐานให้ "ทุกบทบาทของทุกบริษัท" ──────────────────────
-- ครอบทุกแถวใน core.roles ที่เป็นของบริษัท (org_id IS NOT NULL) ไม่เลือกเฉพาะ
-- code ที่รู้จัก — บทบาทที่ลูกค้าสร้างเองก็ต้องได้ตามกติกาเดียวกัน
-- (SUPER_ADMIN เป็น role ระบบ org_id = NULL ผ่านทุกอย่างอยู่แล้ว ไม่ต้องมอบ)
--
-- สิ่งที่ **ไม่อยู่ในชุดนี้โดยตั้งใจ**: core.* (หลังบ้านคือที่ที่แก้สิทธิ์ของทุกคนได้),
-- hr.salary.* / hr.payroll.* (ข้อมูลส่วนบุคคล), maintenance.expense.* / po.*
-- (ตัวเลขการเงิน) และ report_task.activity.view (บันทึกการกระทำทั้งบริษัท)
INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
JOIN "core"."permissions" p ON p."code" IN (
  'report_task.access',
  'report_task.task.view',
  'report_task.calendar.view',
  'report_task.report.view',
  'report_task.report.submit',
  'report_task.issue.view',
  'hr.access',
  'hr.employee.view',
  'maintenance.access',
  'maintenance.workorder.view',
  'maintenance.property.view',
  'maintenance.asset.view',
  'maintenance.pm.view',
  'maintenance.contractor.view',
  'chat.access'
)
WHERE r."org_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3) สิทธิ์รายงานและงานส่วนที่เกินพื้นฐาน ให้บทบาทระดับหัวหน้าที่มีอยู่แล้ว ──
-- ไม่เดาจาก role.code (บริษัทตั้ง code เองได้ — เหตุผลเดียวกับ
-- 20260816160000_backfill_view_all_by_admin_perm) แต่ดูจากสิ่งที่บทบาทนั้นถืออยู่จริง
-- ใช้ core.admin เป็นเส้นแบ่ง = บทบาทที่เข้าหลังบ้านของบริษัทได้ ตรงกับ
-- MANAGER/CEO/ADMIN ใน defaults.ts และไม่กินเลยไปถึง CARETAKER/TECHNICIAN
-- ที่ถือ maintenance.workorder.manage อยู่แต่ไม่ใช่ระดับหัวหน้า
INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT DISTINCT lead."role_id", p."id"
FROM (
  SELECT rp."role_id"
  FROM "core"."role_permissions" rp
  JOIN "core"."permissions" pp ON pp."id" = rp."permission_id"
  WHERE pp."code" = 'core.admin'
) lead
JOIN "core"."permissions" p ON p."code" IN (
  'report_task.task.manage',
  'report_task.calendar.manage',
  'report_task.report.manage',
  'report_task.issue.manage',
  'report_task.activity.view'
)
ON CONFLICT DO NOTHING;

-- ── 4) สิทธิ์รายงานและงานเต็มชุด (รวม setting.manage) ให้แอดมินบริษัท ──
-- แคบกว่าข้อ 3: เฉพาะบทบาทที่แก้บทบาท/สิทธิ์ของคนอื่นได้ = ADMIN ใน defaults.ts
-- บทบาทอื่นที่อยากได้เพิ่ม แอดมินไปติ๊กให้เองได้ที่ /admin/roles (ซึ่งข้อ 1
-- เพิ่งทำให้กลุ่มสิทธิ์นี้โผล่ในหน้านั้นเป็นครั้งแรก)
INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT DISTINCT admin_role."role_id", p."id"
FROM (
  SELECT rp."role_id"
  FROM "core"."role_permissions" rp
  JOIN "core"."permissions" pp ON pp."id" = rp."permission_id"
  WHERE pp."code" = 'core.role.manage'
) admin_role
JOIN "core"."permissions" p ON p."code" LIKE 'report\_task.%'
ON CONFLICT DO NOTHING;
