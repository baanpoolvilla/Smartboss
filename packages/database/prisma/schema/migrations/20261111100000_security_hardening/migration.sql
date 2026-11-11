-- ตรวจความปลอดภัยระบบ HR (11/11/2569) — เพิ่มคอลัมน์อย่างเดียว ค่าเริ่มต้นทุกตัว = พฤติกรรมเดิม
-- ยืนยันตัวตน 2 ชั้น (แอป Authenticator) รายบัญชี
ALTER TABLE "core"."users" ADD COLUMN IF NOT EXISTS "totp_secret" TEXT;
ALTER TABLE "core"."users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" TIMESTAMP(3);
ALTER TABLE "core"."users" ADD COLUMN IF NOT EXISTS "totp_recovery_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "core"."users" ADD COLUMN IF NOT EXISTS "totp_last_step" INTEGER;
-- หน้า "อุปกรณ์ที่เข้าสู่ระบบอยู่"
ALTER TABLE "core"."refresh_tokens" ADD COLUMN IF NOT EXISTS "ip" TEXT;
-- สวิตช์รายบริษัท (หลังบ้าน › ความปลอดภัย) — ปิดไว้ทั้งหมดจนกว่าบริษัทจะเปิดเอง
ALTER TABLE "core"."security_settings" ADD COLUMN IF NOT EXISTS "require_current_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "core"."security_settings" ADD COLUMN IF NOT EXISTS "idle_logout_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "core"."security_settings" ADD COLUMN IF NOT EXISTS "two_factor_roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "core"."security_settings" ADD COLUMN IF NOT EXISTS "salary_allowed_ips" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "core"."security_settings" ADD COLUMN IF NOT EXISTS "notify_new_device" BOOLEAN NOT NULL DEFAULT false;
