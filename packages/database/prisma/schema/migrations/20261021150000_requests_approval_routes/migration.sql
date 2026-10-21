-- เบิกจ่าย & OT: เส้นทางอนุมัติตั้งได้รายบริษัท รายประเภท (ผู้ใช้ 21/10/2569 — "ไม่อยากให้ CEO อนุมัติเยอะ
-- ผ่าน HR เลย ยอดเยอะจริง ๆ ค่อยให้ CEO") · ใบที่ยอดเกินเกณฑ์อนุมัติสองขั้น: HR → CEO
ALTER TABLE "requests"."requests"
  ADD COLUMN "need_ceo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "first_decided_by" TEXT,
  ADD COLUMN "first_decided_by_name" TEXT,
  ADD COLUMN "first_decided_at" TIMESTAMPTZ(6),
  ADD COLUMN "first_decision_note" TEXT;

ALTER TABLE "requests"."settings" ADD COLUMN "approval_routes" JSONB;

GRANT UPDATE ("need_ceo", "first_decided_by", "first_decided_by_name", "first_decided_at", "first_decision_note") ON "requests"."requests" TO workforce_app;
