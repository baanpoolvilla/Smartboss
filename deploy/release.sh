#!/usr/bin/env bash
# ปล่อยเวอร์ชันใหม่ — ใช้ทั้งตอนติดตั้งครั้งแรกและตอนอัปเดต
#
#   sudo -u smartboss bash deploy/release.sh          # ดึงโค้ดล่าสุดแล้ว build
#   sudo -u smartboss bash deploy/release.sh --no-pull # build ของที่มีอยู่
#
# ไม่รัน migration ให้โดยตั้งใจ — การเปลี่ยนโครงฐานข้อมูลควรเป็นการตัดสินใจของคน
# ไม่ใช่ผลข้างเคียงของการ deploy (ถ้ามี migration ใหม่ สคริปต์จะเตือนแล้วหยุด)
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-/etc/smartboss/smartboss.env}
PULL=1
[ "${1:-}" = "--no-pull" ] && PULL=0

step() { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }

if [ "$PULL" = 1 ]; then
  step "ดึงโค้ดล่าสุด"
  git pull --ff-only
fi

step "ติดตั้ง dependency"
# --frozen-lockfile: ถ้า lockfile ไม่ตรงกับ package.json ให้ล้มดีกว่าแอบอัปเกรดเอง
pnpm install --frozen-lockfile

step "ตรวจว่ามี migration ค้างไหม"
set -a; . "$ENV_FILE"; set +a
export DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
if ! pnpm --filter @smartboss/database exec prisma migrate status >/dev/null 2>&1; then
  cat >&2 <<'EOF'

⚠ มี migration ที่ยังไม่ได้ลง หรือฐานข้อมูลไม่ตรงกับโค้ด

  ตรวจก่อน:  pnpm --filter @smartboss/database exec prisma migrate status
  ลงจริง:    pnpm db:deploy && pnpm wf:migrate

  แล้วค่อยรัน release.sh อีกครั้ง — ทำตอนที่มีเวลาดูผล ไม่ใช่ตอนรีบ
EOF
  exit 1
fi

step "build"
pnpm turbo run build

step "รีสตาร์ตบริการ"
# ⚠ ลำดับชื่อบริการต้องตรงกับบรรทัดใน /etc/sudoers.d/smartboss เป๊ะ
# sudoers เทียบคำสั่งแบบตรงตัวรวมลำดับอาร์กิวเมนต์ สลับที่แล้วจะโดนถามรหัสผ่าน
# แล้วค้างรอ input ที่ไม่มีวันมา (ดู docs/deploy.md ข้อ 8)
sudo systemctl restart smartboss-web smartboss-api smartboss-worker smartboss-gateway

step "รอให้พร้อมรับงาน"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/login; then
    echo "เว็บพร้อมแล้ว"
    break
  fi
  [ "$i" = 60 ] && { echo "เว็บไม่ขึ้นใน 60 วินาที — ดู: journalctl -u smartboss-web -n 100" >&2; exit 1; }
  sleep 1
done

systemctl --no-pager --lines=0 status \
  smartboss-web smartboss-api smartboss-worker smartboss-gateway || true

printf '\n\033[1;32m✔ ปล่อยเวอร์ชันใหม่เรียบร้อย\033[0m\n'
