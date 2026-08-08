-- ══════════════════════════════════════════════════════════════════════
--  ลบโมดูล HR เดิมทิ้ง — ถูกแทนที่ด้วยระบบ workforce (PostgreSQL schema "workforce")
--  ดู docs/workforce_integration.md และ attendance/workforce/HANDOFF.md
--
--  ตารางที่หายไป 10 ตาราง:
--    departments  positions  employees  salary_records  pay_components
--    employee_pay_components  payroll_settings  payroll_runs
--    payroll_items  payroll_item_lines
--
--  ⚠️ ข้อมูลในตารางเหล่านี้ถูกลบถาวร — ก่อนรันบนเครื่องที่มีข้อมูลจริง
--     ต้อง export หรือย้ายไป workforce.people / employments /
--     compensation_rates / payroll_runs ก่อน (HANDOFF ข้อ 2)
--
--  หมายเหตุ: permission `hr.*` ใน core.permissions ยังอยู่ตามเดิม
--  เพราะเป็นตัวที่บริษัทใช้กำหนดสิทธิ์ แล้วถูกแปลงเป็น role ของ workforce
--  ด้วย mapSmartbossRoles() ตอน sync
-- ══════════════════════════════════════════════════════════════════════

DROP SCHEMA IF EXISTS "hr" CASCADE;
