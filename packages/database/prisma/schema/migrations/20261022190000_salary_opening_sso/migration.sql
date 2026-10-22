-- เงินเดือน: ยอดสะสมก่อนเริ่มใช้ระบบ (ยอดยกมา) — เพิ่มประกันสังคมสะสม ให้ภาษีทั้งปีหักประกันสังคมครบ
-- prev_income/prev_tax เดิมใช้ทั้ง "ที่ทำงานเดิม" และ "บริษัทนี้ก่อนเริ่มใช้ระบบ" (รวมกันกรอกช่องเดียว)
ALTER TABLE "salary"."profiles"
  ADD COLUMN "prev_sso" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT "profiles_prev_sso_nonneg" CHECK ("prev_sso" >= 0);
