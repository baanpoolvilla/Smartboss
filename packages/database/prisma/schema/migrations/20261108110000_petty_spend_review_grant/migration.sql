-- ให้แอปแก้ได้เฉพาะช่องผลการตรวจ "ซื้อของเอง" (20261108100000_petty_spend_review) — ยอด/คนถือ/เวลา ยังแก้ไม่ได้เหมือนเดิม
GRANT UPDATE ("review_status", "reviewed_by_user_id", "reviewed_by_name", "reviewed_at", "review_note") ON "requests"."petty_cash_entries" TO workforce_app;
