-- ความคิดเห็นใบงาน: แนบได้หลายรูปต่อความคิดเห็น + บันทึกการลบ (log)
-- เพิ่มคอลัมน์อย่างเดียว ของเดิม (image_url รูปเดียว) ยังอ่านได้เหมือนเดิม
--   image_urls = รูปของความคิดเห็นนี้ (ความคิดเห็นใหม่ใช้ช่องนี้) · แถว log = รูปที่ถูกลบ (เก็บไว้ให้ผู้จัดการดูย้อนหลัง)
--   kind       = NULL ความคิดเห็นปกติ · 'log' บันทึกของระบบ (ลบรูป/ลบความคิดเห็น/เปลี่ยนบ้าน) ลบ/แก้ไม่ได้
ALTER TABLE "maintenance"."work_order_comments" ADD COLUMN IF NOT EXISTS "image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "maintenance"."work_order_comments" ADD COLUMN IF NOT EXISTS "kind" TEXT;
