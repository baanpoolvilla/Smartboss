#!/usr/bin/env bash
# เปิด psql ต่อฐานข้อมูล production โดยไม่ต้องพิมพ์รหัสผ่านเอง
#
#   sudo bash deploy/psql.sh                      เข้าโหมดโต้ตอบ
#   sudo bash deploy/psql.sh -c "select 1"        รันคำสั่งเดียวแล้วออก
#   sudo bash deploy/psql.sh -f script.sql        รันไฟล์
#
# อ่านรหัสผ่านจาก /etc/smartboss/smartboss.env — ไม่ต้องเอารหัสไปวางใน
# ประวัติคำสั่งของ shell ซึ่งเก็บไว้ใน ~/.bash_history แบบไม่เข้ารหัส
set -euo pipefail

ENV_FILE=${ENV_FILE:-/etc/smartboss/smartboss.env}
[ -r "$ENV_FILE" ] || { echo "อ่าน $ENV_FILE ไม่ได้ (ต้องใช้ sudo)" >&2; exit 1; }

set -a; . "$ENV_FILE"; set +a
: "${DATABASE_URL:?ไม่มี DATABASE_URL ใน $ENV_FILE}"

# -P pager=off: ผลลัพธ์ยาว ๆ จะได้ไม่ติดอยู่ใน less จนงงว่าทำไมค้าง
exec psql "${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" -P pager=off "$@"
