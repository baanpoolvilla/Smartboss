-- บทบาท (Role) ผูกกับแผนก (Department) ได้แบบไม่บังคับ — เป็นแค่ป้ายจัดกลุ่ม/
-- ทางลัด UI เท่านั้น ไม่มีผลต่อสิทธิ์การใช้งานใดๆ (สิทธิ์ยังมาจาก RolePermission
-- ล้วนๆ เหมือนเดิม) role ที่ใช้ข้ามแผนกได้ (ADMIN/MANAGER/STAFF/CEO ฯลฯ) ปล่อย
-- ว่างไว้ตามปกติ

-- AlterTable
ALTER TABLE "core"."roles" ADD COLUMN "department_id" TEXT;

-- CreateIndex
CREATE INDEX "roles_department_id_idx" ON "core"."roles"("department_id");

-- AddForeignKey
ALTER TABLE "core"."roles" ADD CONSTRAINT "roles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
