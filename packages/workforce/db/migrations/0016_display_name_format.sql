-- รูปแบบชื่อที่แสดงทั้งระบบ — ตั้งได้รายนิติบุคคล
--
-- เดิมชื่อที่แสดงถูกประกอบตายตัวในโค้ด (ชื่อเล่นถ้ามี ไม่งั้นชื่อจริง) แต่แต่ละบริษัท
-- เรียกคนไม่เหมือนกัน — บางที่เรียกชื่อเล่นนำหน้าชื่อจริง บางที่ใช้ชื่อ-นามสกุลเต็ม
-- ตามเอกสาร ⇒ ย้ายมาเป็นค่าตั้งของบริษัทตามกฎ "กฎธุรกิจห้ามฝังในโค้ด"
--
--   NICK_FIRST  ชื่อเล่น-ชื่อจริง     กีม-Katawut
--   FIRST_NICK  ชื่อจริง(ชื่อเล่น)    Katawut(กีม)
--   FULL_NAME   ชื่อจริง นามสกุล      Katawut Nantaprom
--
-- ค่าเริ่มต้นเป็น FULL_NAME เพราะเป็นแบบเดียวที่ไม่ต้องพึ่งช่องชื่อเล่น: ข้อมูลที่มี
-- อยู่แล้วหลายแถวกรอกชื่อเล่นเป็น "Katawut-กีม" (ใส่รูปแบบลงไปในข้อมูลเอง) ถ้าตั้งต้น
-- เป็น NICK_FIRST จะได้ชื่อซ้อนกันทันทีที่ deploy โดยที่ยังไม่มีใครได้เลือกอะไรเลย
ALTER TABLE workforce.companies
  ADD COLUMN IF NOT EXISTS display_name_format text NOT NULL DEFAULT 'FULL_NAME';

ALTER TABLE workforce.companies
  ADD CONSTRAINT companies_display_name_format_check
  CHECK (display_name_format IN ('NICK_FIRST', 'FIRST_NICK', 'FULL_NAME'));
