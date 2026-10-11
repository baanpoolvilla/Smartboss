-- ค่าตั้งแจ้งเตือนเป็นของ "คน" ไม่ผูกบริษัท — บัญชีผู้ดูแลระบบสูงสุด (ไม่สังกัดบริษัท) บันทึกได้
-- (เดิม org_id บังคับ ⇒ ขึ้น "ยังไม่ได้อยู่ในบริษัท" ตอนกดเปิด/ปิด)
ALTER TABLE "core"."notification_preferences" ALTER COLUMN "org_id" DROP NOT NULL;
