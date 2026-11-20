-- วิธีคิดอัตรา OT ให้บริษัทเลือก (ผู้ใช้ 20/11/2569): standard = ตามตาราง % (แบบเดิม) · flat = เงินเดือน ÷ 30 ÷ 8 × ชั่วโมง
-- ค่าเริ่มต้น standard = ทุกบริษัทคิดเหมือนเดิมจนกว่าจะเลือกเอง
ALTER TABLE "requests"."settings" ADD COLUMN "ot_rate_mode" TEXT NOT NULL DEFAULT 'standard';
