#!/usr/bin/env bash
# สำรองฐานข้อมูล — ตั้งให้รันทุกคืนด้วย cron (ดู docs/deploy.md หัวข้อ 9)
#
#   sudo bash deploy/backup.sh
#
# เก็บ 14 วันล่าสุดไว้บนเครื่อง และถ้าตั้ง BACKUP_BUCKET ไว้จะส่งขึ้น Cloud Storage ด้วย
#
# ⚠ backup ที่อยู่บนเครื่องเดียวกับฐานข้อมูล ไม่ใช่ backup — VM หายไปก็หายด้วยกัน
#   ตั้ง BACKUP_BUCKET เสมอ หรืออย่างน้อยเปิด snapshot schedule ของดิสก์
set -euo pipefail

ENV_FILE=${ENV_FILE:-/etc/smartboss/smartboss.env}
OUT_DIR=${OUT_DIR:-/var/backups/smartboss}
KEEP_DAYS=${KEEP_DAYS:-14}

set -a; . "$ENV_FILE"; set +a
: "${DATABASE_URL:?ไม่มี DATABASE_URL}"

mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/smartboss-$STAMP.dump"

# -Fc = custom format บีบอัดในตัว และ pg_restore เลือกกู้ทีละตารางได้
# รันผ่านคอนเทนเนอร์เพื่อให้เวอร์ชัน pg_dump ตรงกับเซิร์ฟเวอร์เสมอ
docker compose -f /opt/smartboss/deploy/docker-compose.yml exec -T postgres \
  pg_dump -Fc -d "$DATABASE_URL" > "$FILE"

# ไฟล์เปล่า/ครึ่ง ๆ ถือว่าล้มเหลว — ดีกว่าเก็บไฟล์เสียไว้แล้วนึกว่ามี backup
SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 10000 ]; then
  echo "backup ขนาดผิดปกติ ($SIZE ไบต์) — ถือว่าล้มเหลว" >&2
  rm -f "$FILE"
  exit 1
fi

chmod 600 "$FILE"
echo "เขียนแล้ว: $FILE ($((SIZE / 1024 / 1024)) MB)"

if [ -n "${BACKUP_BUCKET:-}" ]; then
  gcloud storage cp "$FILE" "gs://$BACKUP_BUCKET/db/" --quiet
  echo "ส่งขึ้น gs://$BACKUP_BUCKET/db/ แล้ว"
fi

# ล้างของเก่าหลังจากตัวใหม่สำเร็จแล้วเท่านั้น
find "$OUT_DIR" -name 'smartboss-*.dump' -mtime "+$KEEP_DAYS" -delete
echo "เหลือไฟล์ในเครื่อง: $(find "$OUT_DIR" -name 'smartboss-*.dump' | wc -l) ไฟล์"
