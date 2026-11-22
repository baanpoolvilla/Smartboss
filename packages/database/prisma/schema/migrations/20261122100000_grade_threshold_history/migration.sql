-- เกณฑ์เกรดชุดเก่า: เปลี่ยนเกณฑ์แล้วรอบที่ผ่านมาคงเกรดเดิม
ALTER TABLE "core"."performance_settings" ADD COLUMN "grade_threshold_history" JSONB NOT NULL DEFAULT '[]';
