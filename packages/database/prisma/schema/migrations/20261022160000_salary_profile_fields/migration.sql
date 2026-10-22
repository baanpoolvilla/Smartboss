-- เงินเดือน: ช่องข้อมูลตาม mockup แบบ FlowAccount (ผู้ใช้ 22/10/2569) + ใครเห็นเงินเดือนได้
--
-- คนที่เห็น/แก้เงินเดือนได้ = CEO + รายชื่อที่ CEO เลือก (editor_user_ids) — ไม่ผูกกับบทบาท
-- ("มีแค่ CEO และหัวหน้า HR เท่านั้น") · SUPER_ADMIN เห็นได้ช่วงติดตั้ง (super_admin_access) CEO ปิดเองได้
-- สิทธิ์ salary.manage/approve/settings ที่ migration ก่อนหน้าสร้างไว้จึงไม่ใช้แล้ว — เหลือ salary.access (ดูสลิปตัวเอง)

ALTER TABLE "salary"."settings"
  ADD COLUMN "editor_user_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "super_admin_access" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "company_tax_id" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sso_employer_no" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sso_branch" TEXT NOT NULL DEFAULT '000000',
  ADD COLUMN "pay_bank_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "pay_bank_account" TEXT NOT NULL DEFAULT '',
  -- ค่า OT นับเป็นค่าจ้างคิดประกันสังคม (ค่าเริ่มต้นนับ — นิยาม "ค่าจ้าง" ตาม พ.ร.บ.ประกันสังคม) ให้บริษัทยืนยัน/ปรับได้
  ADD COLUMN "ot_sso_base" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "salary"."profiles"
  ADD COLUMN "pay_channel" TEXT NOT NULL DEFAULT 'transfer',
  ADD COLUMN "tax_mode" TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN "tax_fixed_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tax_none_reason" TEXT NOT NULL DEFAULT '',
  -- ค่าลดหย่อนตาม ล.ย.01 [{key, label, amount}] — extra_allowance = ผลรวม (เก็บไว้คู่กันให้คำนวณเร็ว)
  ADD COLUMN "allowances" JSONB NOT NULL DEFAULT '[]',
  -- เงินได้/ภาษีจากที่ทำงานเดิมของปีนั้น (คนเข้ากลางปี) — ใช้เฉพาะปี prev_year
  ADD COLUMN "prev_income" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "prev_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "prev_year" INTEGER,
  ADD CONSTRAINT "profiles_channel_valid" CHECK ("pay_channel" IN ('transfer', 'cash')),
  ADD CONSTRAINT "profiles_tax_mode_valid" CHECK ("tax_mode" IN ('auto', 'fixed', 'none')),
  ADD CONSTRAINT "profiles_money_nonneg" CHECK ("tax_fixed_amount" >= 0 AND "prev_income" >= 0 AND "prev_tax" >= 0);

ALTER TABLE "salary"."runs"
  -- วันที่โอนจริง (อาจไม่ตรงวันจ่ายที่ตั้งไว้)
  ADD COLUMN "paid_on" DATE;

ALTER TABLE "salary"."run_lines"
  -- ช่องทางรับเงิน ณ ตอนคำนวณ (เงินสดไม่อยู่ในไฟล์โอน)
  ADD COLUMN "pay_channel" TEXT NOT NULL DEFAULT 'transfer',
  -- แก้พร้อมกันสองคน: บันทึกต้องส่ง updated_at ที่เห็นมา ไม่ตรง = มีคนแก้ไปก่อน
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- เงินสด: พนักงานกด "ได้รับเงินแล้ว"
  ADD COLUMN "received_at" TIMESTAMPTZ(6);

-- สิทธิ์ที่ไม่ใช้แล้ว (เห็น/แก้เงินเดือนตัดสินจาก CEO + รายชื่อที่ CEO เลือก ไม่ใช่บทบาท)
DELETE FROM "core"."role_permissions" rp
 USING "core"."permissions" p
 WHERE rp."permission_id" = p."id" AND p."code" IN ('salary.manage', 'salary.approve', 'salary.settings');
DELETE FROM "core"."permissions" WHERE "code" IN ('salary.manage', 'salary.approve', 'salary.settings');
