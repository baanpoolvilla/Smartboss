-- ผูก PR/PO เข้ากับใบงานต้นทาง — เปิดใบสั่งซื้อจากหน้าใบงานได้เลย
--
-- NULL = ใบสั่งซื้อที่เปิดลอย ๆ (ของเดิมทั้งหมด รวมที่ import มาจาก ChangYai)
-- จึงไม่ต้อง backfill อะไร ความหมายเดิมไม่เปลี่ยน
--
-- ON DELETE SET NULL ไม่ใช่ CASCADE — PR/PO เป็นเอกสารการเงินที่กินเลขที่ไปแล้ว
-- ลบใบงานทิ้งแล้วให้ใบสั่งซื้อหายตามไปคือทำยอดค่าใช้จ่ายย้อนหลังเพี้ยน

-- AlterTable
ALTER TABLE "maintenance"."purchase_orders" ADD COLUMN "work_order_id" TEXT;

-- CreateIndex
CREATE INDEX "purchase_orders_work_order_id_idx" ON "maintenance"."purchase_orders"("work_order_id");

-- AddForeignKey
ALTER TABLE "maintenance"."purchase_orders"
  ADD CONSTRAINT "purchase_orders_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "maintenance"."work_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
