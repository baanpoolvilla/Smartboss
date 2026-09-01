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
# -P pager=off: ไม่งั้น psql เปิดผลลัพธ์ใน less แล้วสคริปต์ค้างรอคนกด q
# ทีละตาราง ซึ่งทำให้ข้อความสรุปท้ายสุดถูกกลืนไปด้วย
sql()  { psql "$DATABASE_URL" -P pager=off -v ON_ERROR_STOP=1 -f "$1"; }

step "1/6 build เครื่องมือที่ต้องใช้"
# wf:migrate กับ wf:sync เป็น TypeScript ที่ import @workforce/config ซึ่ง package.json
# ชี้ main ไปที่ dist/index.js — แต่ dist/ ถูก gitignore ไว้ ⇒ เครื่องที่ clone ใหม่
# จะยังไม่มี แล้วตายด้วย MODULE_NOT_FOUND ที่อ่านแล้วไม่รู้ว่าเกี่ยวอะไรกับฐานข้อมูล
#
# build เฉพาะสายที่ต้องใช้ก็พอ ไม่ต้องรอทั้งโปรเจกต์
#
# ⚠ เรียกทุกครั้ง ห้ามเขียนเงื่อนไข "ถ้ามี dist แล้วข้าม" — เคยเขียนแบบนั้นโดยเช็ค
# แค่ config/dist ผลคือรอบที่ build ล้มกลางทาง (domain พัง แต่ config ผ่านไปแล้ว)
# รอบถัดมาจะข้าม build ทั้งหมดแล้วไปตายที่ wf:sync ด้วย MODULE_NOT_FOUND แทน
# turbo มีแคชของมันเองที่เช็คจากเนื้อไฟล์จริง แม่นกว่าการเดาจากไฟล์ใดไฟล์หนึ่ง
# ไม่มีอะไรเปลี่ยน = FULL TURBO จบในไม่กี่วินาที
if ! pnpm turbo run build --filter=@workforce/db...; then
  # build ที่ล้มกลางทางทิ้ง dist/ ไว้ครึ่ง ๆ พร้อม .tsbuildinfo ที่ไม่ตรงกัน
  # แล้ว tsc จะติดสถานะเสียถาวร ขึ้น TS5055 "would overwrite input file" ทุกรอบ
  # แม้แก้ต้นเหตุแล้วก็ตาม — พิสูจน์แล้วว่าเอาไฟล์ที่ขาดกลับมาอย่างเดียวไม่พอ
  #
  # ไม่ล้างทุกรอบเพราะปกติ turbo แคชให้อยู่แล้ว ล้างเฉพาะตอนล้มจริง
  echo ""
  echo "build ล้ม — ล้าง dist ที่ค้างแล้วลองใหม่อีกครั้ง"
  rm -rf packages/workforce/*/dist
  pnpm turbo run build --filter=@workforce/db... --force
fi

step "2/6 สร้าง role ของแอป (ยังไม่ต้องมี schema)"
sql packages/workforce/db/sql/00-create-role.sql

step "3/6 สร้างตาราง"
# Prisma → schema core + maintenance + report_task
pnpm db:deploy
# Drizzle → schema workforce
pnpm wf:migrate

step "4/6 สิทธิ์และฟังก์ชันค้นหา (ต้องหลัง wf:migrate เพราะอ้าง schema workforce)"
sql packages/workforce/db/sql/01-grant-app-role.sql
# ข้ามอันนี้ = เครื่องสแกน activate ไม่ได้ ขึ้น 401 ทั้งที่ token ถูก
sql packages/workforce/db/sql/02-lookup-functions-owner.sql
# ข้ามอันนี้ = หน้าสรุปผลงานไม่แสดงมาสาย/ขาดงานเลย ตลอดกาล โดยไม่มี error
# ไฟล์นี้ตรวจเจ้าของฟังก์ชันในตัว ถ้าผิดจะล้มทันทีแทนที่จะเงียบ
sql packages/workforce/db/sql/04-performance-lookup.sql
# Discord Report Sync (ชั่วคราว) — ทางอ่านวันทำงานรายคนสำหรับตัวตัดสิน
sql packages/workforce/db/sql/05-report-working-days.sql

step "5/6 ข้อมูลตั้งต้น"
pnpm db:seed     # role / permission / ผู้ใช้แอดมิน
pnpm wf:sync     # ปั้น tenant + principal ของ workforce จาก core.organizations/users

step "6/6 ตรวจผล"
psql "$DATABASE_URL" -P pager=off -f packages/workforce/db/sql/03-verify.sql

cat <<'EOF'

──────────────────────────────────────────────────────────────────────
อ่านผลข้างบนก่อนไปต่อ:
  • ทุกช่อง verdict ต้องเป็น ok
  • ข้อ 5 ต้องไม่มีแถว
  • ข้อ 6 ต้องได้ 0 ทั้งสองช่อง

  ⚠ ถ้าข้อ 6 ไม่ใช่ 0 แปลว่าการแยกข้อมูลระหว่างบริษัทพัง — อย่าเปิดใช้งาน
──────────────────────────────────────────────────────────────────────
EOF
