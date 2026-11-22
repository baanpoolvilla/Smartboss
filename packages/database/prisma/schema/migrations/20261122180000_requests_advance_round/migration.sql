-- เบิกล่วงหน้า: เฉพาะคนงานรายวัน + เพดานนับต่อรอบครึ่งเดือน (ผู้ใช้ 22/11/2569) · ค่าเริ่มต้น = แบบเดิม (ทุกคน · ต่อเดือน)
ALTER TABLE "requests"."settings"
  ADD COLUMN "advance_cap_period" TEXT NOT NULL DEFAULT 'month',
  ADD COLUMN "advance_workers_only" BOOLEAN NOT NULL DEFAULT false;
