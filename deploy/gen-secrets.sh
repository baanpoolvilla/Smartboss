#!/usr/bin/env bash
# สร้างความลับทั้งหมดที่ production ต้องใช้ — รันครั้งเดียว เก็บผลไว้ให้ดี
#
#   bash deploy/gen-secrets.sh
#
# เอาผลไปวางใน /etc/smartboss/smartboss.env และ deploy/.env ตามที่บอกไว้ในหัวข้อ
set -euo pipefail

need() { command -v "$1" >/dev/null || { echo "ไม่พบคำสั่ง $1" >&2; exit 1; }; }
need openssl

# JWT_SECRET กับ AUTH_SMARTBOSS_SECRET ต้องเป็นค่าเดียวกัน จึงสุ่มครั้งเดียวแล้วพิมพ์สองที่
JWT=$(openssl rand -base64 48 | tr -d '\n')

cat <<EOF

════════════════════════════════════════════════════════════════════
 ใส่ใน /etc/smartboss/smartboss.env
════════════════════════════════════════════════════════════════════

# ⚠ สองบรรทัดนี้ต้องเป็นค่าเดียวกันเสมอ ไม่ตรงกัน = ทุกหน้า HR ขึ้น 401
JWT_SECRET=$JWT
AUTH_SMARTBOSS_SECRET=$JWT

# ⚠ หายแล้วเลขบัตร ปชช./เลขบัญชีที่เข้ารหัสไว้กู้ไม่ได้ — สำรองแยกจาก backup ฐานข้อมูล
FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')

CRON_SECRET=$(openssl rand -hex 32)

SEED_ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '\n/+=' | cut -c1-16)Aa1!
SEED_STAFF_PASSWORD=$(openssl rand -base64 18 | tr -d '\n/+=' | cut -c1-16)Aa1!

════════════════════════════════════════════════════════════════════
 ใส่ใน deploy/.env  (docker compose อ่านไฟล์นี้)
════════════════════════════════════════════════════════════════════

POSTGRES_USER=smartboss
POSTGRES_DB=smartboss
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')

MINIO_ROOT_USER=smartboss
MINIO_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')

════════════════════════════════════════════════════════════════════

อย่าลืม: เอา POSTGRES_PASSWORD ไปประกอบเป็น DATABASE_URL ใน smartboss.env ด้วย
        และ MINIO_ROOT_USER/PASSWORD ไปเป็น S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
        (ทั้งคู่ของ S3_* และ STORAGE_*)

EOF
