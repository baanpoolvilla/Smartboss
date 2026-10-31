-- แอดมิน (ADMIN = IT/ดูแลระบบ) ไม่เห็นใบเบิกของทุกคนอีกต่อไป (ผู้ใช้ 31/10/2569 "เราไม่เกี่ยวข้องอะไรกับส่วนนี้")
-- คนที่ยังเห็นทุกใบ: HR/CEO (อนุมัติ/จ่าย) + คนที่ HR ติ๊กให้ถือเงินสดย่อย · แอดมินยังเห็นใบที่ตัวเองยื่นหรือลงให้คนอื่น
-- บทบาทอื่นที่ติ๊ก "ดูทุกใบ" ไว้ไม่แตะ
DELETE FROM "core"."role_permissions" rp
USING "core"."roles" r, "core"."permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."code" = 'ADMIN' AND p."code" = 'requests.view_all';
