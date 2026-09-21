-- คำขอแก้เวลาต้องมีผู้อนุมัติกี่คน — ตั้งได้รายนิติบุคคล ค่าเริ่มต้น 1 คน
--
-- 0012 บังคับ 2 คนตายตัวในโค้ด ("อนุมัติ 2 คน") แต่บริษัทที่หัวหน้างานมีคนเดียว
-- คำขอจะค้างอยู่ที่ "รอผู้จัดการคนที่ 2" ตลอดไป ⇒ ย้ายมาเป็นค่าตั้งของบริษัท
-- ตามกฎ "กฎธุรกิจห้ามฝังในโค้ด" · ค่าเริ่มต้น 1 คนตามที่เจ้าของระบบสั่ง
-- (บริษัทที่เพิ่มมาแล้วได้ 1 ทันทีจาก DEFAULT ของคอลัมน์นี้)
--
-- CHECK ของ 0012 (คนที่ 2 ต้องต่างจากคนที่ 1 และจากผู้ขอ) ยังอยู่ตามเดิม —
-- มีผลเฉพาะตอนบริษัทตั้งไว้ 2 คนแล้วมีคนที่ 2 จริงเท่านั้น
ALTER TABLE workforce.companies
  ADD COLUMN IF NOT EXISTS attendance_correction_approvals integer NOT NULL DEFAULT 1;

ALTER TABLE workforce.companies
  ADD CONSTRAINT companies_correction_approvals_range
  CHECK (attendance_correction_approvals BETWEEN 1 AND 2);
