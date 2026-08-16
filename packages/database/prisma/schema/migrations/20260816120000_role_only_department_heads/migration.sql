-- ยุบสิทธิ์การใช้งานระบบให้เหลือ Role อย่างเดียว — ตัด position ทิ้งทั้งหมด (entity
-- + ตารางสิทธิ์คู่ขนานของมัน) และตัดสิทธิ์ของ department ออกด้วย (department ยังอยู่
-- แต่เหลือแค่ข้อมูลโครงสร้างองค์กร) แล้วเพิ่ม department_heads ไว้แทน สำหรับระบุ
-- "ใครเป็นหัวหน้าแผนกไหน" ซึ่งใช้คุม data scope (เห็น/แก้ข้อมูลของทั้งแผนก) แยกจาก
-- Role permission (ทำอะไรได้ในระบบ) โดยสิ้นเชิง — ดู PLAN_role_only_department_heads_2.md

-- DropForeignKey
ALTER TABLE "core"."users" DROP CONSTRAINT "users_position_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."department_permissions" DROP CONSTRAINT "department_permissions_department_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."department_permissions" DROP CONSTRAINT "department_permissions_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."position_permissions" DROP CONSTRAINT "position_permissions_position_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."position_permissions" DROP CONSTRAINT "position_permissions_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."positions" DROP CONSTRAINT "positions_org_id_fkey";

-- DropIndex
DROP INDEX "core"."users_position_id_idx";

-- DropTable
DROP TABLE "core"."department_permissions";

-- DropTable
DROP TABLE "core"."position_permissions";

-- DropTable
DROP TABLE "core"."positions";

-- AlterTable
ALTER TABLE "core"."users" DROP COLUMN "position_id";

-- CreateTable
CREATE TABLE "core"."department_heads" (
    "department_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_heads_pkey" PRIMARY KEY ("department_id","user_id")
);

-- CreateIndex
CREATE INDEX "department_heads_user_id_idx" ON "core"."department_heads"("user_id");

-- AddForeignKey
ALTER TABLE "core"."department_heads" ADD CONSTRAINT "department_heads_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."department_heads" ADD CONSTRAINT "department_heads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- Data backfill (Phase 1.7 ของแผน) — ต้องรันพร้อม DROP ชุดนี้เสมอ ไม่งั้น
-- ADMIN/CEO ของทุกบริษัทที่มีอยู่แล้วจะเสีย scope การมองเห็นข้อมูลทันทีหลัง
-- deploy (ไม่มี department_heads แถวไหนเลย + ไม่มี core.data.view_all ให้ใคร)
-- ═══════════════════════════════════════════════════════════════════════

-- 1) เพิ่ม permission ใหม่ "เห็น/แก้ข้อมูลทุกคนในบริษัท ข้าม scope ระดับแผนก"
INSERT INTO "core"."permissions" ("id", "code", "module_id")
VALUES (gen_random_uuid(), 'core.data.view_all', NULL)
ON CONFLICT ("code") DO NOTHING;

-- 2) grant ให้ role ADMIN/CEO ของทุกบริษัทที่มีอยู่แล้ว (role ใหม่ที่สร้างหลังจากนี้
--    มาจาก defaults.ts ที่แก้ไว้แล้วใน Phase 2.2 — ไม่ต้อง backfill เพิ่ม)
INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
CROSS JOIN "core"."permissions" p
WHERE p."code" = 'core.data.view_all'
  AND r."code" IN ('ADMIN', 'CEO')
ON CONFLICT DO NOTHING;

-- 3) เก็บกวาด permission code ของ position ที่เลิกใช้แล้ว (role_permissions ที่อ้างถึง
--    จะถูกลบตาม cascade อัตโนมัติ)
DELETE FROM "core"."permissions" WHERE "code" IN ('core.position.view', 'core.position.manage');
