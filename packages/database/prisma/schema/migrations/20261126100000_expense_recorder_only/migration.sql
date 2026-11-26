-- ใบงานที่รอบันทึกค่าใช้จ่าย: ลงได้เฉพาะผู้บันทึกที่ติ๊กไว้ + Boss (ผู้ใช้ 26/11/2569) · ค่าเริ่มต้นปิด = เหมือนเดิม
ALTER TABLE "core"."performance_settings" ADD COLUMN "expense_recorder_only" BOOLEAN NOT NULL DEFAULT false;
