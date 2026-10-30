-- พนักงานใหม่ (ยังไม่ผ่านโปร) ตั้งต้น "ไม่ได้" ค่าคอม + เบี้ยขยัน จนกว่า HR ติ๊กให้ (ผู้ใช้ 30/10/2569)
-- คนที่เริ่มงานก่อนวันที่ลงระบบนี้ (probation_from) ใช้แบบเดิมทุกอย่าง

-- วันเริ่มใช้กติกา: แถวที่มีอยู่ = วันที่รัน migration · บริษัทที่สร้างแถวทีหลัง = วันสร้างแถว
ALTER TABLE "core"."commission_settings"
  ADD COLUMN "probation_from" DATE DEFAULT CURRENT_DATE,
  -- พนักงานใหม่ที่ HR เอาติ๊ก "ไม่ให้ค่าคอม (ยังไม่ผ่านโปร)" ออกแล้ว = ผ่านโปร ได้ค่าคอม
  ADD COLUMN "probation_passed_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- เบี้ยขยัน: NULL = ยังไม่ได้เลือก → คนเก่าได้ (เหมือนเดิม) · พนักงานใหม่ไม่ได้ · แถวเดิมคงค่าที่ตั้งไว้
ALTER TABLE "salary"."profiles"
  ALTER COLUMN "diligence_eligible" DROP NOT NULL,
  ALTER COLUMN "diligence_eligible" DROP DEFAULT;
