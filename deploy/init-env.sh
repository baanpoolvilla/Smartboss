#!/usr/bin/env bash
# สร้างไฟล์ตั้งค่าทั้งสองไฟล์พร้อมความลับที่สุ่มให้เสร็จ — รันครั้งเดียวตอนติดตั้ง
#
#   sudo bash deploy/init-env.sh \
#     --domain easyboss.app \
#     --email  you@example.com \
#     --org    "บริษัท ตัวอย่าง จำกัด"
#
# ทำไมไม่ให้กรอกมือ: ค่าที่ต้องกรอกมี 30 กว่าตัว และมีคู่ที่ **ต้องตรงกันเป๊ะ**
# (JWT_SECRET กับ AUTH_SMARTBOSS_SECRET · รหัส Postgres ที่ต้องไปโผล่ใน DATABASE_URL
#  ด้วย · คีย์ MinIO ที่ใช้ทั้งชื่อ S3_* และ STORAGE_*) พิมพ์เองพลาดง่ายมาก
# และอาการเวลาพลาดคือ "login ได้แต่ทุกหน้า HR ขึ้น 401" ซึ่งไล่หาสาเหตุยาก
#
# ⚠ ไม่ทับไฟล์เดิม — ถ้ามีอยู่แล้วจะหยุดทันที กันเผลอสร้างความลับชุดใหม่
#   ทับของเดิมแล้วข้อมูลที่เข้ารหัสไว้อ่านไม่ออกตลอดกาล
set -euo pipefail

ENV_FILE=/etc/smartboss/smartboss.env
COMPOSE_ENV=/opt/smartboss/deploy/.env

DOMAIN=""
EMAIL=""
ORG_NAME="บริษัทของฉัน"
ORG_SLUG="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN=$2; shift 2 ;;
    --email)  EMAIL=$2;  shift 2 ;;
    --org)    ORG_NAME=$2; shift 2 ;;
    --slug)   ORG_SLUG=$2; shift 2 ;;
    *) echo "ไม่รู้จักตัวเลือก: $1" >&2; exit 1 ;;
  esac
done

[ -n "$DOMAIN" ] || { echo "ต้องระบุ --domain เช่น --domain easyboss.app" >&2; exit 1; }
[ -n "$EMAIL" ]  || { echo "ต้องระบุ --email  (ใช้แจ้งเตือนใบรับรองหมดอายุ)" >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo "ต้องรันด้วย sudo" >&2; exit 1; }

for f in "$ENV_FILE" "$COMPOSE_ENV"; do
  if [ -e "$f" ]; then
    echo "มี $f อยู่แล้ว — หยุดเพื่อไม่ให้ทับความลับเดิม" >&2
    echo "ถ้าตั้งใจจะสร้างใหม่จริง ให้ย้ายไฟล์เดิมออกไปก่อน" >&2
    exit 1
  fi
done

command -v openssl >/dev/null || { echo "ไม่พบ openssl" >&2; exit 1; }

# ตัวอักษรล้วน ไม่มี / + = @ : — เพราะรหัส Postgres ต้องไปประกอบเป็น URL
# และค่าใน deploy/.env ถูก docker compose ตีความ $ เป็นตัวแปร
alnum() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-"${1:-32}"; }

JWT=$(openssl rand -base64 48 | tr -d '\n')
FIELD_KEY=$(openssl rand -base64 32 | tr -d '\n')   # ต้อง 32 ไบต์พอดี ห้ามตัดอักขระ
CRON=$(openssl rand -hex 32)
PG_PASS=$(alnum 32)
MINIO_PASS=$(alnum 32)
ADMIN_PASS="$(alnum 16)aA1!"                        # ผ่านเกณฑ์ยาว >= 12 ของ seed

APP_DOMAIN="app.$DOMAIN"
DEVICE_DOMAIN="device.$DOMAIN"
FILES_DOMAIN="files.$DOMAIN"

# 750 ไม่ใช่ 700 — user smartboss ต้อง "เดินผ่าน" โฟลเดอร์นี้ได้ถึงจะอ่านไฟล์ข้างในได้
# ถ้าเป็น 700 เจ้าของ root ไฟล์ข้างในจะเปิดให้กลุ่มอ่านแค่ไหนก็ไม่มีประโยชน์
# (systemd ไม่เจอปัญหานี้เพราะอ่าน EnvironmentFile ตอนยังเป็น root — แต่สคริปต์
#  อย่าง bootstrap-db.sh / backup.sh ที่รันในนาม smartboss จะอ่านไม่ได้)
install -d -o root -g smartboss -m 750 /etc/smartboss

umask 077
cat > "$ENV_FILE" <<EOF
# สร้างโดย deploy/init-env.sh เมื่อ $(date '+%F %T')
# ⚠ ไฟล์นี้คือความลับทั้งหมดของระบบ — สำรองไว้นอกเครื่องด้วย

DATABASE_URL=postgresql://smartboss:$PG_PASS@127.0.0.1:5432/smartboss?sslmode=disable
DATABASE_URL_UNPOOLED=postgresql://smartboss:$PG_PASS@127.0.0.1:5432/smartboss?sslmode=disable
DATABASE_SSL=false

REDIS_URL=redis://127.0.0.1:6379

JWT_SECRET=$JWT
AUTH_SMARTBOSS_SECRET=$JWT
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
COOKIE_SECURE=true

FIELD_ENCRYPTION_KEY=$FIELD_KEY
CRON_SECRET=$CRON

WORKFORCE_API_BASE=http://127.0.0.1:4100/api/workforce/v1

S3_BUCKET=smartboss
S3_ENDPOINT=https://$FILES_DOMAIN
S3_REGION=auto
S3_ACCESS_KEY_ID=smartboss
S3_SECRET_ACCESS_KEY=$MINIO_PASS

STORAGE_DRIVER=s3
STORAGE_BUCKET=smartboss
STORAGE_REGION=auto
STORAGE_ENDPOINT=https://$FILES_DOMAIN
STORAGE_ACCESS_KEY_ID=smartboss
STORAGE_SECRET_ACCESS_KEY=$MINIO_PASS
STORAGE_FORCE_PATH_STYLE=true

NODE_ENV=production
LOG_LEVEL=info

HTTP_HOST=127.0.0.1
HTTP_PORT=4100
CORS_ALLOWED_ORIGINS=https://$APP_DOMAIN

AUTH_PROVIDER=smartboss
AUTH_ISSUER=smartboss
AUTH_AUDIENCE=smartboss-web
AUTH_TENANT_CLAIM=orgId

GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=3200
GATEWAY_UPSTREAM=http://127.0.0.1:4100
GATEWAY_RATE_LIMIT=120

DEFAULT_TIME_ZONE=Asia/Bangkok
DEFAULT_CURRENCY=THB

SEED_ORG_NAME=$ORG_NAME
SEED_ORG_SLUG=$ORG_SLUG
SEED_ADMIN_EMAIL=$EMAIL
SEED_ADMIN_NAME=ผู้ดูแลระบบสูงสุด
SEED_ADMIN_PASSWORD=$ADMIN_PASS
EOF

cat > "$COMPOSE_ENV" <<EOF
# สร้างโดย deploy/init-env.sh เมื่อ $(date '+%F %T')
POSTGRES_USER=smartboss
POSTGRES_DB=smartboss
POSTGRES_PASSWORD=$PG_PASS

MINIO_ROOT_USER=smartboss
MINIO_ROOT_PASSWORD=$MINIO_PASS

APP_DOMAIN=$APP_DOMAIN
DEVICE_DOMAIN=$DEVICE_DOMAIN
FILES_DOMAIN=$FILES_DOMAIN
ACME_EMAIL=$EMAIL
EOF

chown root:smartboss "$ENV_FILE"
chmod 640 "$ENV_FILE"
chown smartboss:smartboss "$COMPOSE_ENV"
chmod 600 "$COMPOSE_ENV"

cat <<EOF

────────────────────────────────────────────────────────────────
 สร้างไฟล์ตั้งค่าเรียบร้อย
────────────────────────────────────────────────────────────────
  $ENV_FILE      (root:smartboss 640)
  $COMPOSE_ENV   (smartboss 600)

  โดเมน:  https://$APP_DOMAIN
          https://$DEVICE_DOMAIN
          https://$FILES_DOMAIN

  บัญชีผู้ดูแลระบบสูงสุดที่จะถูกสร้างตอน seed:
      อีเมล      $EMAIL
      รหัสผ่าน   $ADMIN_PASS

  ⚠ จดรหัสผ่านนี้ไว้ แล้วเปลี่ยนทันทีหลัง login ครั้งแรก
  ⚠ ห้ามส่งเนื้อหาของไฟล์ทั้งสองให้ใครเด็ดขาด
  ⚠ สำรอง FIELD_ENCRYPTION_KEY เก็บไว้นอกเครื่อง — หายแล้วเลขบัตรประชาชน
    และเลขบัญชีที่เข้ารหัสไว้กู้ไม่ได้เลย ไม่มีทางลัด
────────────────────────────────────────────────────────────────

EOF
