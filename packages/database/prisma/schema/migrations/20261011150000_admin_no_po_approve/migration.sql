-- อนุมัติ PR/PO เป็นของ CEO คนเดียว — บทบาท ADMIN (ฝ่าย IT) เคยได้ maintenance.po.approve มาด้วย
-- ⇒ ได้แจ้งเตือน "PR ใหม่ รออนุมัติ" ทุกใบและเห็นปุ่มอนุมัติ ทั้งที่หน้า PR ขึ้น "รอ CEO อนุมัติ"
-- IT ยังดำเนินการ/รับของ/ลบความเห็นได้ผ่าน maintenance.admin (ดูหน้า purchase-orders)
--
-- กันพลาด: ถอนเฉพาะบริษัทที่ยังมีคนอื่น (ผ่านบทบาทที่ไม่ใช่ ADMIN) อนุมัติได้อยู่ — ไม่งั้นบริษัทที่ CEO
-- ถือแค่บทบาท ADMIN จะไม่เหลือใครอนุมัติ PR ได้เลย (บริษัทนั้นค่อยจัดบทบาทเองที่ /admin/roles)
DELETE FROM "core"."role_permissions" rp
USING "core"."roles" r, "core"."permissions" p
WHERE rp."role_id" = r."id"
  AND rp."permission_id" = p."id"
  AND p."code" = 'maintenance.po.approve'
  AND r."code" = 'ADMIN'
  AND r."org_id" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "core"."users" u
    JOIN "core"."user_roles" ur ON ur."user_id" = u."id"
    JOIN "core"."roles" r2 ON r2."id" = ur."role_id"
    JOIN "core"."role_permissions" rp2 ON rp2."role_id" = r2."id" AND rp2."permission_id" = p."id"
    WHERE u."org_id" = r."org_id" AND u."is_active" AND r2."code" <> 'ADMIN'
  );
