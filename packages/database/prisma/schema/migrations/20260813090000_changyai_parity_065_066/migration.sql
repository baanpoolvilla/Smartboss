-- ตามให้ทัน changyai migration 065 (requires_expense) และ 066 (external upload note)
--
-- DEFAULT true = พฤติกรรมเดิม (ทุกงานต้องบันทึกค่าใช้จ่าย) ⇒ แถวที่มีอยู่แล้ว
-- ไม่เปลี่ยนความหมาย และข้อมูลที่ import จาก changyai ก็ตรงกันพอดี

-- AlterTable
ALTER TABLE "maintenance"."work_orders" ADD COLUMN "requires_expense" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "maintenance"."pm_schedules" ADD COLUMN "requires_expense" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "maintenance"."work_order_external_photos" ADD COLUMN "note" TEXT;
