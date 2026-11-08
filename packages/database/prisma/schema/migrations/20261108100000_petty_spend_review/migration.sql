-- เงินสดย่อย "ซื้อของเอง" ต้องมีคนตรวจทีหลัง (ผู้ใช้ 8/11/2569: ทำเรื่องไม่ทัน จ่ายจากเงินที่ถืออยู่ไปก่อน แล้วค่อยลงว่าจ่ายอะไร ให้อนุมัติทีหลัง)
--   review_status: NULL = รายการเดิม/ไม่ต้องตรวจ · pending = รอตรวจ · approved = ผ่าน · rejected = ไม่ผ่าน (เงินขาด ค้างคืน)
-- เพิ่มอย่างเดียว ยอดคงเหลือคิดจาก delta เหมือนเดิม (จ่ายไปแล้วหักทันที ไม่ผ่านก็ยังหัก จนกว่าจะได้เงินคืนแล้วยกเลิกรายการ)
ALTER TABLE "requests"."petty_cash_entries"
  ADD COLUMN "review_status" TEXT,
  ADD COLUMN "reviewed_by_user_id" TEXT,
  ADD COLUMN "reviewed_by_name" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "review_note" TEXT,
  ADD CONSTRAINT "petty_cash_entries_review_status_valid" CHECK ("review_status" IS NULL OR "review_status" IN ('pending', 'approved', 'rejected'));
