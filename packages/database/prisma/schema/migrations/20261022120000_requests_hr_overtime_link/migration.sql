-- เบิกจ่าย & OT: ใบ OT ที่สร้างให้อัตโนมัติตอน HR อนุมัติ OT ที่ระบบจับจากเวลาสแกน (แท็บ "OT รออนุมัติ")
-- ผูกกับ workforce.overtime_requests.id ไว้กันสร้างซ้ำ และให้ปฏิทินทีมไม่นับ OT เดียวกันสองครั้ง (ผู้ใช้ 22/10/2569)
ALTER TABLE "requests"."requests" ADD COLUMN "hr_overtime_request_id" TEXT;

CREATE INDEX "requests_org_id_hr_overtime_request_id_idx" ON "requests"."requests"("org_id", "hr_overtime_request_id");
