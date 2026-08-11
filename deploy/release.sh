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

step "สร้าง Prisma client ใหม่ให้ตรงกับ schema ที่เพิ่งดึงมา"
# ⚠ ห้ามตัดขั้นนี้ออก — prisma generate ผูกไว้กับ postinstall ซึ่งจะทำงาน
# ต่อเมื่อ pnpm install ได้ติดตั้งอะไรจริง ๆ  แต่การแก้ schema ไม่ได้เปลี่ยน
# dependency ⇒ install เป็น no-op ⇒ client ยังเป็นตัวเก่าที่ไม่รู้จักคอลัมน์ใหม่
# แล้ว build จะล้มด้วย "Object literal may only specify known properties"
# ซึ่งอ่านแล้วนึกว่าโค้ดผิด ทั้งที่โค้ดถูก client ต่างหากที่เก่า (เจอมาแล้วตอน deploy จริง)
pnpm db:generate

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
# -n = ไม่ยอมถามรหัสผ่าน ล้มทันทีแทน
#
# ⚠ ลำดับชื่อบริการต้องตรงกับบรรทัดใน /etc/sudoers.d/smartboss เป๊ะ
# sudoers เทียบคำสั่งแบบตรงตัวรวมลำดับอาร์กิวเมนต์ — ถ้าไม่ match sudo จะถาม
# รหัสผ่าน แต่ smartboss เป็น system user ที่ไม่มีรหัสผ่าน สคริปต์เลยค้างรอ
# input ที่ไม่มีวันมา จนกว่าจะกด Ctrl-C (เจอมาแล้วตอนติดตั้งจริง)
if ! sudo -n systemctl restart smartboss-web smartboss-api smartboss-worker smartboss-gateway; then
  cat >&2 <<'HINT'

✗ รีสตาร์ตบริการไม่ได้ — ยังไม่ได้ติดตั้งกฎ sudoers

  ติดตั้งด้วยบัญชีที่มีสิทธิ์ sudo (ไม่ใช่ smartboss):

    sudo install -m 440 -o root -g root \
         /opt/smartboss/deploy/sudoers.d-smartboss /etc/sudoers.d/smartboss
    sudo visudo -c

  แล้วรัน release.sh ใหม่ — build ที่ทำไปแล้วถูกแคชไว้ ไม่ต้องรอนาน

HINT
  exit 1
fi

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
