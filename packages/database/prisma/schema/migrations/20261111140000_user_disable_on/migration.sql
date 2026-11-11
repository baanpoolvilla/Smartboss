-- พนักงานพ้นสภาพ → ปิดบัญชีเข้าสู่ระบบหลังวันสุดท้าย (11/11/2569) — null = ไม่ได้ตั้งไว้ (ทุกบัญชีเดิม ไม่มีอะไรเปลี่ยน)
ALTER TABLE "core"."users" ADD COLUMN IF NOT EXISTS "disable_on" DATE;
