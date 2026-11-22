-- กติกาเบิกล่วงหน้าตั้งเองได้รายบริษัท (ผู้ใช้ 22/11/2569): ใครเบิกได้ · เพดานแยกคนงาน/พนักงาน · ต่อเดือน/ครึ่งเดือน/สัปดาห์ · จำนวนครั้ง · วันเริ่มรอบ
-- null = ใช้เพดานเดิม (advance_cap_mode/value/period, advance_workers_only) — ของเดิมไม่เปลี่ยน
ALTER TABLE "requests"."settings" ADD COLUMN "advance_rules" JSONB;
