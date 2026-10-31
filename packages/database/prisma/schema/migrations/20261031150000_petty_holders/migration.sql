-- คนถือเงินสดย่อย: HR/CEO ติ๊กรายคนที่หน้าเงินสดย่อย แทนสิทธิ์ "ถือเงินสดย่อย" ของบทบาท (ผู้ใช้ 31/10/2569)
-- ติ๊กแล้วได้ครบในทีเดียว: การ์ด + เมนูเงินสดย่อย + ทะเบียนช่าง/ร้านภายนอก + จ่ายจากเงินสดย่อยของตัวเอง
CREATE TABLE "requests"."petty_holders" (
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "added_by_name" TEXT NOT NULL DEFAULT '',
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by_name" TEXT,

    CONSTRAINT "petty_holders_pkey" PRIMARY KEY ("org_id", "user_id")
);

-- ตั้งต้น = คนที่ขึ้นการ์ดอยู่ตอนนี้ (บทบาทที่ไม่ใช่ SUPER_ADMIN ที่มีสิทธิ์ถือเงินสดย่อย) — ลงก่อนเปิด RLS
INSERT INTO "requests"."petty_holders" ("org_id", "user_id", "added_by_name")
SELECT DISTINCT u."org_id", u."id", 'ย้ายจากสิทธิ์บทบาท'
FROM "core"."users" u
JOIN "core"."user_roles" ur ON ur."user_id" = u."id"
JOIN "core"."roles" r ON r."id" = ur."role_id" AND r."code" <> 'SUPER_ADMIN'
JOIN "core"."role_permissions" rp ON rp."role_id" = r."id"
JOIN "core"."permissions" p ON p."id" = rp."permission_id" AND p."code" = 'requests.petty_cash'
WHERE u."org_id" IS NOT NULL AND u."is_active" = true
ON CONFLICT DO NOTHING;

ALTER TABLE "requests"."petty_holders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requests"."petty_holders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "petty_holders_isolation" ON "requests"."petty_holders"
  USING ("org_id" = "requests".current_org_id()) WITH CHECK ("org_id" = "requests".current_org_id());

GRANT SELECT, INSERT ON "requests"."petty_holders" TO workforce_app;
GRANT UPDATE ("added_by_name", "added_at", "removed_at", "removed_by_name") ON "requests"."petty_holders" TO workforce_app;

-- "เห็นเงินสดย่อยของทุกคน" ให้เฉพาะคนที่ทำงานกับเงินจริง (อนุมัติ/จ่าย) — ไม่ใช่แค่ "ดูทุกใบ"
-- (IT ที่ถือบทบาทแอดมินเห็นเมนูการเงินเหมือนพนักงานทั่วไป · 20261031120000 ให้ไปจาก view_all)
DELETE FROM "core"."role_permissions" rp
USING "core"."permissions" p
WHERE rp."permission_id" = p."id" AND p."code" = 'requests.petty_view'
  AND NOT EXISTS (
    SELECT 1 FROM "core"."role_permissions" rp2
    JOIN "core"."permissions" p2 ON p2."id" = rp2."permission_id"
    WHERE rp2."role_id" = rp."role_id" AND p2."code" IN ('requests.approve', 'requests.approve_ceo', 'requests.pay')
  );
