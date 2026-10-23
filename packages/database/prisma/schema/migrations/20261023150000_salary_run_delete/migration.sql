-- ลบรอบเงินเดือนที่ยังเป็นร่างได้ (สร้างผิด/เปิดงวดผิด) — ฐานข้อมูลกันเองว่าลบได้เฉพาะร่าง
-- (ส่งอนุมัติ/อนุมัติ/จ่ายแล้ว ลบไม่ได้ แม้โค้ดฝั่งเว็บพลาด)
CREATE OR REPLACE FUNCTION "salary".guard_run_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'draft' THEN
    RAISE EXCEPTION 'only a draft salary run can be deleted (status %)', OLD."status";
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER "runs_delete_draft_only" BEFORE DELETE ON "salary"."runs"
  FOR EACH ROW EXECUTE FUNCTION "salary".guard_run_delete();

GRANT DELETE ON "salary"."runs" TO workforce_app;
