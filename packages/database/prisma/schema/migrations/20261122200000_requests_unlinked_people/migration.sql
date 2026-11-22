-- ยื่นเบิกให้คนที่ยังไม่มีในระบบ (พิมพ์ชื่อไว้ก่อน ผูกทีหลัง — ผู้ใช้ 22/11/2569) · ค่าเริ่มต้น = ปิด (แบบเดิม)
-- ใบใช้คอลัมน์เดิม: beneficiary_user_id = NULL + beneficiary_name ที่พิมพ์ · ผูกแล้วแก้ beneficiary_* (มีสิทธิ์ UPDATE อยู่แล้ว)
ALTER TABLE "requests"."settings" ADD COLUMN "unlinked_allowed" BOOLEAN NOT NULL DEFAULT false;
