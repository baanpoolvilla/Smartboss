-- เพดานพื้นที่ไฟล์คลังกลางรายบริษัท (แพ็กเกจเสริม) — หน่วย MB
-- nullable: NULL = ใช้ค่ากลางจาก env (COMPANY_FILES_ORG_QUOTA_GB) แถวเดิมทุกบริษัทเป็น NULL
-- ไม่แตะข้อมูลเดิม เป็นการเพิ่มคอลัมน์ล้วน

-- AlterTable
ALTER TABLE "core"."organizations" ADD COLUMN     "storage_quota_mb" INTEGER;
