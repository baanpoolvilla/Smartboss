-- แผนก/ตำแหน่ง เป็นของกลาง (core) ใช้ร่วมกันได้ทุกโมดูล — เดิม report_task
-- เก็บแผนกของตัวเองเป็นก้อน JSON ใน report_task.stores คีย์ "departments"
-- และ "ตำแหน่ง" เป็นแค่ข้อความอิสระต่อคน (jobTitle) ไม่มีที่มาตรฐานกลาง
--
-- กำหนดสิทธิ์ระดับแผนก/ตำแหน่งได้เหมือน Role (department_permissions /
-- position_permissions มิเรอร์ role_permissions ทุกกระเบียด) — สิทธิ์ที่
-- login ได้จะรวมจากทั้ง role + department + position ของ user คนนั้น
--
-- department_id / position_id ที่ users เป็น FK เดี่ยว (ไม่ใช่ระบบ employment
-- history แบบ workforce.employment_assignments) — ตั้งใจให้เบา แทนตำแหน่ง/
-- แผนก "ปัจจุบัน" ของ user ในระบบ ไม่ใช่ระบบ HR เต็มรูปแบบ

-- CreateTable
CREATE TABLE "core"."departments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."positions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."department_permissions" (
    "department_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "department_permissions_pkey" PRIMARY KEY ("department_id","permission_id")
);

-- CreateTable
CREATE TABLE "core"."position_permissions" (
    "position_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "position_permissions_pkey" PRIMARY KEY ("position_id","permission_id")
);

-- AlterTable
ALTER TABLE "core"."users" ADD COLUMN "department_id" TEXT,
                            ADD COLUMN "position_id" TEXT;

-- CreateIndex
CREATE INDEX "departments_org_id_idx" ON "core"."departments"("org_id");

-- CreateIndex
CREATE INDEX "positions_org_id_idx" ON "core"."positions"("org_id");

-- CreateIndex
CREATE INDEX "users_department_id_idx" ON "core"."users"("department_id");

-- CreateIndex
CREATE INDEX "users_position_id_idx" ON "core"."users"("position_id");

-- AddForeignKey
ALTER TABLE "core"."departments" ADD CONSTRAINT "departments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."positions" ADD CONSTRAINT "positions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."department_permissions" ADD CONSTRAINT "department_permissions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."department_permissions" ADD CONSTRAINT "department_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "core"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."position_permissions" ADD CONSTRAINT "position_permissions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "core"."positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."position_permissions" ADD CONSTRAINT "position_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "core"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "core"."positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
