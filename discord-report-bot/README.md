# Discord Report Sync Bot (ชั่วคราว)

ฟังห้องรายงานใน Discord แล้วยิงข้อมูลดิบเข้า SmartBoss
(`POST /api/report-task/discord-ingest`) — SmartBoss เป็นคนตัดสินผล/หักคะแนน
ดูภาพรวมที่ `docs/discord_report_integration.md`

## ตั้งค่า
1. คัดลอก `.env.example` เป็น `.env` แล้วกรอก:
   - `DISCORD_TOKEN` — จาก Developer Portal หน้า "บอท" (อย่าโชว์บนสตรีม)
   - `SMARTBOSS_URL` — dev ใช้ `http://localhost:3000`
   - `DISCORD_SYNC_SECRET` — ตั้งค่าเดียวกับใน `apps/web/.env`
2. เปิด 2 intents ใน Developer Portal หน้า "บอท": MESSAGE CONTENT + SERVER MEMBERS

## รัน
```bash
cd discord-report-bot
npm install      # หรือ pnpm install
npm start
```
ขึ้น "✅ บอทออนไลน์" = พร้อมทำงาน ลองพิมพ์ในห้องที่ตั้งค่าไว้ใน /admin/discord-reports

## เลิกใช้
ปิดโปรเซสบอท + ลบโฟลเดอร์นี้ได้เลย ไม่กระทบ SmartBoss
