#!/usr/bin/env bash
# ตั้งฐานข้อมูลครั้งแรก — **ลำดับสำคัญมาก** สคริปต์นี้มีไว้เพื่อไม่ให้เรียงผิด
#
#   sudo -u smartboss bash deploy/bootstrap-db.sh
#
# รันซ้ำได้ ทุกขั้นเป็น idempotent (migration ข้ามของที่ลงแล้ว, SQL ใช้ IF NOT EXISTS,
# seed ใช้ upsert) แต่ไม่ควรรันบ่อยโดยไม่มีเหตุ
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-/etc/smartboss/smartboss.env}

[ -r "$ENV_FILE" ] || { echo "อ่าน $ENV_FILE ไม่ได้" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${DATABASE_URL:?ไม่มี DATABASE_URL ใน $ENV_FILE}"

# migration และการสร้าง role ต้องใช้เส้น direct ไม่ใช่ pooled
export DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"

step() { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
sql()  { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$1"; }

step "1/5 สร้าง role ของแอป (ยังไม่ต้องมี schema)"
sql packages/workforce/db/sql/00-create-role.sql

step "2/5 สร้างตาราง"
# Prisma → schema core + maintenance + report_task
pnpm db:deploy
# Drizzle → schema workforce
pnpm wf:migrate

step "3/5 สิทธิ์และฟังก์ชันค้นหา (ต้องหลัง wf:migrate เพราะอ้าง schema workforce)"
sql packages/workforce/db/sql/01-grant-app-role.sql
# ข้ามอันนี้ = เครื่องสแกน activate ไม่ได้ ขึ้น 401 ทั้งที่ token ถูก
sql packages/workforce/db/sql/02-lookup-functions-owner.sql
# ข้ามอันนี้ = หน้าสรุปผลงานไม่แสดงมาสาย/ขาดงานเลย ตลอดกาล โดยไม่มี error
# ไฟล์นี้ตรวจเจ้าของฟังก์ชันในตัว ถ้าผิดจะล้มทันทีแทนที่จะเงียบ
sql packages/workforce/db/sql/04-performance-lookup.sql

step "4/5 ข้อมูลตั้งต้น"
pnpm db:seed     # role / permission / ผู้ใช้แอดมิน
pnpm wf:sync     # ปั้น tenant + principal ของ workforce จาก core.organizations/users

step "5/5 ตรวจผล"
psql "$DATABASE_URL" -f packages/workforce/db/sql/03-verify.sql

cat <<'EOF'

──────────────────────────────────────────────────────────────────────
อ่านผลข้างบนก่อนไปต่อ:
  • ทุกช่อง verdict ต้องเป็น ok
  • ข้อ 5 ต้องไม่มีแถว
  • ข้อ 6 ต้องได้ 0 ทั้งสองช่อง

  ⚠ ถ้าข้อ 6 ไม่ใช่ 0 แปลว่าการแยกข้อมูลระหว่างบริษัทพัง — อย่าเปิดใช้งาน
──────────────────────────────────────────────────────────────────────
EOF
