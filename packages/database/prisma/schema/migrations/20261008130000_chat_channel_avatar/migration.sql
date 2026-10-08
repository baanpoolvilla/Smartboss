-- รูปกลุ่มแชท / รูปห้องรวมทั้งบริษัท — เพิ่มคอลัมน์อย่างเดียว ค่าเดิม null = ไอคอนเดิม
ALTER TABLE "chat"."channels" ADD COLUMN "avatar_url" TEXT;
