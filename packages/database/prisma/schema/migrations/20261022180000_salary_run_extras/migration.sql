-- เงินเดือน: ช่องที่เห็นจากหน้าจอ FlowAccount (PDF จากผู้ใช้ 22/10/2569)
--   โน้ตของรอบ · ค่าธรรมเนียมโอนตอนบันทึกจ่าย · "ไม่จ่ายงวดนี้" รายคน (FlowAccount = ลบรายชื่อ) พร้อมเหตุผล
ALTER TABLE "salary"."runs"
  ADD COLUMN "note" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "bank_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  -- [{employmentId, name, reason, byName, at}]
  ADD COLUMN "excluded" JSONB NOT NULL DEFAULT '[]',
  ADD CONSTRAINT "runs_bank_fee_nonneg" CHECK ("bank_fee" >= 0);
