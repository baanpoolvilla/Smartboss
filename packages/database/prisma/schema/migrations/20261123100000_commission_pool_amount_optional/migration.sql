-- ค่าคอม Grade + Tier: กรอกคะแนน Tier ไว้ก่อน ยังไม่รู้ยอดรวม (ผู้ใช้ 23/11/2569)
-- amount ว่าง = ยังไม่ใส่ยอด (เหมือนไม่มีแถว — งวดเงินเดือนยังส่งไม่ได้) · 0 = รอบนี้ไม่มีค่าคอม
ALTER TABLE "core"."commission_pools" ALTER COLUMN "amount" DROP NOT NULL;
