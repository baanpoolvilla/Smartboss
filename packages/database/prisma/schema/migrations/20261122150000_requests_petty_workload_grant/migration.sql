-- คอลัมน์ใหม่ของ 20261122140000 ที่แอปต้องแก้ได้ (role workforce_app ได้สิทธิ์ UPDATE รายคอลัมน์ ดู 20261021120000)
--   หมวด + ใบรับรองแทนใบเสร็จ: คนยื่นแก้ใบที่ยังรออนุมัติ · ใบรับรองตอนส่งเคลียร์
--   limit_rule_id ไม่ให้แก้ — ใส่ได้ตอนสร้างใบเท่านั้น
GRANT UPDATE ("category", "no_receipt", "clear_no_receipt") ON "requests"."requests" TO workforce_app;

-- รับเงินเข้าเงินสดย่อย (ขายของเก่า แขกจ่ายค่าเสียหาย) — ชนิดรายการใหม่ "income" ยอดต้องเป็นบวก
ALTER TABLE "requests"."petty_cash_entries" DROP CONSTRAINT "petty_kind_valid";
ALTER TABLE "requests"."petty_cash_entries" ADD CONSTRAINT "petty_kind_valid" CHECK ("kind" IN ('top_up', 'spend', 'return', 'adjust', 'income'));
ALTER TABLE "requests"."petty_cash_entries" DROP CONSTRAINT "petty_sign_matches_kind";
ALTER TABLE "requests"."petty_cash_entries" ADD CONSTRAINT "petty_sign_matches_kind" CHECK (("kind" IN ('top_up', 'return', 'income') AND "delta" > 0) OR ("kind" = 'spend' AND "delta" < 0) OR "kind" = 'adjust');
