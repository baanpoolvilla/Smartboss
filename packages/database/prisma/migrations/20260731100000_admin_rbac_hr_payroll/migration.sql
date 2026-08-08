-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "hr";

-- DropIndex
DROP INDEX "core"."roles_code_key";

-- AlterTable
ALTER TABLE "core"."roles" ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "org_id" TEXT;

-- ══════════════════════════════════════════════════════════════════════
--  แยก role ต่อบริษัท (data migration)
--  เดิม role เป็นของกลางทั้งแพลตฟอร์ม → บริษัทหนึ่งแก้สิทธิ์แล้วกระทบทุกบริษัท
--  หลังไมเกรต: SUPER_ADMIN คงเป็น role ระบบ (org_id = NULL, แก้ไม่ได้)
--             role ที่เหลือถูก "โคลน" ให้แต่ละบริษัทถือของตัวเอง
-- ══════════════════════════════════════════════════════════════════════

-- SUPER_ADMIN = role ระบบ ข้ามทุกบริษัท
UPDATE "core"."roles" SET "is_system" = true WHERE "code" = 'SUPER_ADMIN';

-- แผนที่ role กลางเดิม → role ใหม่ของแต่ละบริษัท
CREATE TEMP TABLE _role_clone AS
SELECT r."id" AS old_id, o."id" AS org_id, gen_random_uuid()::text AS new_id
FROM "core"."roles" r
CROSS JOIN "core"."organizations" o
WHERE r."is_system" = false AND r."org_id" IS NULL;

INSERT INTO "core"."roles" ("id", "org_id", "code", "name", "description", "is_system")
SELECT c.new_id, c.org_id, r."code", r."name", r."description", false
FROM _role_clone c
JOIN "core"."roles" r ON r."id" = c.old_id;

-- สิทธิ์ที่ผูกไว้เดิมติดไปกับ role ของทุกบริษัท
INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT c.new_id, rp."permission_id"
FROM _role_clone c
JOIN "core"."role_permissions" rp ON rp."role_id" = c.old_id;

-- ย้าย user ไปถือ role ของบริษัทที่ตัวเองสังกัด
UPDATE "core"."user_roles" ur
SET "role_id" = c.new_id
FROM _role_clone c, "core"."users" u
WHERE ur."user_id" = u."id"
  AND ur."role_id" = c.old_id
  AND u."org_id" = c.org_id;

-- ลบ role กลางเดิมที่โคลนไปแล้ว
-- หมายเหตุ: user ที่ไม่สังกัดบริษัท (org_id IS NULL) และถือ role เหล่านี้จะถูกถอด role ตาม cascade
--          ปกติมีแต่ผู้ใช้ระดับแพลตฟอร์มซึ่งถือ SUPER_ADMIN อยู่แล้ว
DELETE FROM "core"."roles" WHERE "is_system" = false AND "org_id" IS NULL;

DROP TABLE _role_clone;

-- CreateTable
CREATE TABLE "hr"."departments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."positions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."employees" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "nickname" TEXT,
    "national_id" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "department_id" TEXT,
    "position_id" TEXT,
    "employment_type" TEXT NOT NULL DEFAULT 'monthly',
    "status" TEXT NOT NULL DEFAULT 'active',
    "hire_date" DATE NOT NULL,
    "end_date" DATE,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "sso_enrolled" BOOLEAN NOT NULL DEFAULT true,
    "sso_number" TEXT,
    "tax_id" TEXT,
    "has_spouse" BOOLEAN NOT NULL DEFAULT false,
    "child_count" INTEGER NOT NULL DEFAULT 0,
    "other_tax_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."salary_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."pay_components" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "calc_type" TEXT NOT NULL DEFAULT 'fixed',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "is_sso_base" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."employee_pay_components" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_pay_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."payroll_settings" (
    "org_id" TEXT NOT NULL,
    "sso_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sso_rate" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "sso_min_base" DECIMAL(12,2) NOT NULL DEFAULT 1650,
    "sso_max_base" DECIMAL(12,2) NOT NULL DEFAULT 15000,
    "tax_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pay_day" INTEGER NOT NULL DEFAULT 28,
    "company_name" TEXT,
    "company_address" TEXT,
    "payslip_note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "hr"."payroll_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pay_date" DATE,
    "note" TEXT,
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_sso_employee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_sso_employer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."payroll_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "position_name" TEXT,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "work_days" DECIMAL(5,2),
    "gross" DECIMAL(12,2) NOT NULL,
    "total_earning" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sso_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sso_employer" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."payroll_item_lines" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_item_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_org_id_idx" ON "hr"."departments"("org_id");

-- CreateIndex
CREATE INDEX "positions_org_id_idx" ON "hr"."positions"("org_id");

-- CreateIndex
CREATE INDEX "employees_org_id_idx" ON "hr"."employees"("org_id");

-- CreateIndex
CREATE INDEX "employees_user_id_idx" ON "hr"."employees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_org_id_code_key" ON "hr"."employees"("org_id", "code");

-- CreateIndex
CREATE INDEX "salary_records_org_id_idx" ON "hr"."salary_records"("org_id");

-- CreateIndex
CREATE INDEX "salary_records_employee_id_effective_from_idx" ON "hr"."salary_records"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "pay_components_org_id_idx" ON "hr"."pay_components"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_components_org_id_code_key" ON "hr"."pay_components"("org_id", "code");

-- CreateIndex
CREATE INDEX "employee_pay_components_org_id_idx" ON "hr"."employee_pay_components"("org_id");

-- CreateIndex
CREATE INDEX "employee_pay_components_employee_id_idx" ON "hr"."employee_pay_components"("employee_id");

-- CreateIndex
CREATE INDEX "payroll_runs_org_id_idx" ON "hr"."payroll_runs"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_org_id_year_month_key" ON "hr"."payroll_runs"("org_id", "year", "month");

-- CreateIndex
CREATE INDEX "payroll_items_org_id_idx" ON "hr"."payroll_items"("org_id");

-- CreateIndex
CREATE INDEX "payroll_items_employee_id_idx" ON "hr"."payroll_items"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_run_id_employee_id_key" ON "hr"."payroll_items"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "payroll_item_lines_item_id_idx" ON "hr"."payroll_item_lines"("item_id");

-- CreateIndex
CREATE INDEX "roles_org_id_idx" ON "core"."roles"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_org_id_code_key" ON "core"."roles"("org_id", "code");

-- AddForeignKey
ALTER TABLE "core"."roles" ADD CONSTRAINT "roles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."positions" ADD CONSTRAINT "positions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "hr"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "hr"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employees" ADD CONSTRAINT "employees_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "hr"."positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."salary_records" ADD CONSTRAINT "salary_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employee_pay_components" ADD CONSTRAINT "employee_pay_components_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."employee_pay_components" ADD CONSTRAINT "employee_pay_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "hr"."pay_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."payroll_items" ADD CONSTRAINT "payroll_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "hr"."payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."payroll_items" ADD CONSTRAINT "payroll_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."payroll_item_lines" ADD CONSTRAINT "payroll_item_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "hr"."payroll_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

