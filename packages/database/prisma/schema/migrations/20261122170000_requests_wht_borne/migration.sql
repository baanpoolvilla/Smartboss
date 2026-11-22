-- จ่ายร้านไปเต็มแล้วไม่ได้หัก ณ ที่จ่าย — บริษัทออกภาษีให้ (ผู้ใช้ 22/11/2569) · ค่าเริ่มต้น = ปิด (แบบเดิม)
ALTER TABLE "requests"."settings" ADD COLUMN "wht_borne_allowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "requests"."requests" ADD COLUMN "wht_borne" BOOLEAN NOT NULL DEFAULT false;
-- คนยื่นแก้ใบที่ยังรออนุมัติได้ (role workforce_app ได้สิทธิ์ UPDATE รายคอลัมน์)
GRANT UPDATE ("wht_borne") ON "requests"."requests" TO workforce_app;
