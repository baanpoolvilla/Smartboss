#!/usr/bin/env bash
# เรียกงานประจำวันของแอป — ตัวที่ crontab เรียก
#
#   bash /opt/smartboss/deploy/cron-run.sh all
#   bash /opt/smartboss/deploy/cron-run.sh performance
#   bash /opt/smartboss/deploy/cron-run.sh sync ads      ← อาร์กิวเมนต์ที่ 2 = /api/cron/<ชื่อ>
#                                                          (ไม่ใส่ = maintenance เหมือนเดิม)
#
# แยกเป็นสคริปต์แทนที่จะเขียน curl ยาว ๆ ใน crontab เพราะ crontab ไม่มีตัวแปร
# ให้ใช้ และการ source ไฟล์ env ในบรรทัดเดียวพังง่ายเมื่อค่ามีอักขระพิเศษ
set -euo pipefail

ENV_FILE=${ENV_FILE:-/etc/smartboss/smartboss.env}
TASK=${1:-all}
ENDPOINT=${2:-maintenance}
WEB=${WEB_URL:-http://127.0.0.1:3000}

set -a; . "$ENV_FILE"; set +a
: "${CRON_SECRET:?ไม่มี CRON_SECRET ใน $ENV_FILE}"

# -m 300: งานกวาดของบริษัทที่มีข้อมูลเยอะอาจใช้เวลาเป็นนาที แต่ไม่ควรเกิน 5 นาที
# ถ้าเกินแปลว่ามีอะไรผิด อยากให้ล้มแล้วเห็นใน log มากกว่าค้างทับรอบถัดไป
printf '[%s] %s task=%s ' "$(date '+%F %T')" "$ENDPOINT" "$TASK"
curl -fsS -m 300 \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$WEB/api/cron/$ENDPOINT?task=$TASK"
printf '\n'
