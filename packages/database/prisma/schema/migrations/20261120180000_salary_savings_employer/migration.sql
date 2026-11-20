-- เงินสะสม: เก็บแค่ยอดที่พนักงานฝาก เป็นค่าเริ่มต้น (ผู้ใช้ 20/11/2569 "ยังไม่อยากให้คิดตรงสมทบ")
-- ติ๊กเปิดที่ตั้งค่าเงินเดือน = มีช่องบริษัทสมทบ
ALTER TABLE "salary"."settings" ADD COLUMN "savings_employer" BOOLEAN NOT NULL DEFAULT false;
