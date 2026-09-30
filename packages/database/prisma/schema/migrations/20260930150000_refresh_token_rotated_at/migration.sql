-- แยก "หมุนเป็นใบใหม่" ออกจาก "ถูกตัดสิทธิ์" — คอลัมน์ใหม่ nullable ไม่แตะข้อมูลเดิม
ALTER TABLE "core"."refresh_tokens" ADD COLUMN "rotated_at" TIMESTAMP(3);
