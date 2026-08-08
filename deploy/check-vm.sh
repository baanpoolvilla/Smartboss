#!/usr/bin/env bash
# ตรวจว่า VM พร้อมติดตั้ง Smartboss ไหม — รันได้ก่อน clone repo
#
#   curl -fsSL https://raw.githubusercontent.com/baanpoolvilla/Smartboss/main/deploy/check-vm.sh | bash
#   หรือถ้า clone แล้ว:  bash deploy/check-vm.sh
#
# ไม่แก้อะไรทั้งสิ้น อ่านอย่างเดียว — ปลอดภัยที่จะรันซ้ำ
# ออก 0 เมื่อพร้อม, 1 เมื่อมีข้อที่ต้องแก้ก่อน

pass() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; WARN=$((WARN + 1)); }
fail() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }
head2() { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }

WARN=0
FAIL=0

head2 "ระบบปฏิบัติการ"
. /etc/os-release
echo "  $PRETTY_NAME · เคอร์เนล $(uname -r) · $(dpkg --print-architecture)"
case "$ID" in
  ubuntu|debian) pass "รองรับ (คู่มืออ่าน \$ID เองตอนตั้ง repo ของ Docker)" ;;
  *) fail "คู่มือเขียนไว้สำหรับ ubuntu/debian เท่านั้น — เจอ '$ID'" ;;
esac

if [ -f /var/run/reboot-required ]; then
  warn "เครื่องขอ restart อยู่ — รีบูตก่อนติดตั้ง (sudo reboot) แล้วค่อยรันสคริปต์นี้ใหม่"
fi

head2 "แรมและ swap"
MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
echo "  แรม ${MEM_MB} MB · swap ${SWAP_MB} MB"
# next build ใช้แรมพีคสูง ต่ำกว่า ~3.7 GB โดยไม่มี swap มักโดน OOM kill กลางทาง
if [ "$MEM_MB" -ge 3600 ]; then
  pass "แรมพอสำหรับ next build"
elif [ "$SWAP_MB" -ge 2000 ]; then
  warn "แรม ${MEM_MB} MB น้อยกว่าที่แนะนำ แต่มี swap ${SWAP_MB} MB ช่วยไว้ — build จะช้า"
else
  fail "แรม ${MEM_MB} MB และ swap ${SWAP_MB} MB ไม่พอ · เพิ่ม swap ตามข้อ 3 ของคู่มือ หรือขยายเครื่อง"
fi

head2 "พื้นที่ดิสก์"
AVAIL_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
echo "  เหลือ ${AVAIL_GB} GB บน /"
# node_modules + .next + image ของ docker + backup รวมแล้วกินราว 15 GB
if [ "$AVAIL_GB" -ge 25 ]; then pass "พอ"
elif [ "$AVAIL_GB" -ge 15 ]; then warn "เหลือน้อย เผื่อ backup ไม่ได้มาก"
else fail "ไม่พอ ต้องมีอย่างน้อย 15 GB"; fi

head2 "เขตเวลา"
TZ_NOW=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone)
echo "  $TZ_NOW"
if [ "$TZ_NOW" = "Asia/Bangkok" ]; then
  pass "ตรงกับที่ระบบใช้"
else
  warn "ยังไม่ใช่ Asia/Bangkok — cron, log และรอบเงินเดือนอิงเวลาท้องถิ่น"
  echo "     แก้: sudo timedatectl set-timezone Asia/Bangkok"
fi

head2 "เครื่องมือที่ต้องมี"
for cmd in git curl node pnpm docker psql; do
  if command -v "$cmd" >/dev/null 2>&1; then
    case "$cmd" in
      # 2>/dev/null ทุกตัว: บางเครื่อง corepack พ่น stack trace ออก stderr
      # แล้วรายงานจะอ่านไม่ออก ทั้งที่ไม่ใช่ปัญหาของการติดตั้ง
      node)   pass "node $(node -v 2>/dev/null)" ;;
      pnpm)   pass "pnpm $(pnpm -v 2>/dev/null || echo '(อ่านเวอร์ชันไม่ได้)')" ;;
      docker) pass "docker $(docker --version 2>/dev/null | awk '{print $3}' | tr -d ,)" ;;
      psql)   pass "psql $(psql --version 2>/dev/null | awk '{print $3}')" ;;
      *)      pass "$cmd" ;;
    esac
  else
    warn "ยังไม่มี $cmd (ติดตั้งในข้อ 3 ของคู่มือ)"
  fi
done

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | tr -dc '0-9.' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 20 ]; then
    fail "node ต้องเป็นเวอร์ชัน 20 ขึ้นไป (เจอ $(node -v))"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "เรียก docker ได้โดยไม่ต้อง sudo"
  else
    warn "เรียก docker ไม่ได้ด้วยผู้ใช้นี้ — ต้องอยู่ในกลุ่ม docker แล้ว logout/login ใหม่"
  fi
fi

head2 "พอร์ตที่ต้องว่าง"
# นับแยกจาก FAIL รวม ไม่งั้นถ้ามีข้อผิดพลาดจากหัวข้อก่อนหน้า จะไม่ยอมพิมพ์ "ว่างทั้งหมด"
PORTS_BUSY=0
for port in 80 443 3000 3200 4100 5432 6379 9000; do
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"; then
    fail "พอร์ต $port ถูกใช้อยู่แล้ว — หาว่าอะไรจับไว้ (sudo ss -ltnp | grep :$port)"
    PORTS_BUSY=$((PORTS_BUSY + 1))
  fi
done
[ "$PORTS_BUSY" -eq 0 ] && pass "ว่างทั้งหมด"

head2 "ทางออกอินเทอร์เน็ต"
if curl -fsS -m 10 -o /dev/null https://registry.npmjs.org/ 2>/dev/null; then
  pass "ออกเน็ตได้ (ต้องใช้ดึง dependency และ image)"
else
  fail "ออกเน็ตไม่ได้ — ติดตั้งอะไรไม่ได้เลย"
fi

head2 "IP สาธารณะ (ใช้ตั้ง DNS)"
PUBIP=$(curl -fsS -m 5 -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null)
if [ -n "$PUBIP" ]; then
  echo "  $PUBIP"
  echo "  ⚠ ต้องเป็น static address · ถ้ายังเป็น ephemeral รีบูตแล้วเลขนี้จะเปลี่ยน"
  echo "    แล้ว DNS จะพังและใบรับรอง HTTPS ต่ออายุไม่ได้ (ดูข้อ 1 ของคู่มือ)"
else
  warn "อ่าน IP จาก metadata ไม่ได้ — เครื่องนี้อาจไม่ใช่ GCE"
fi

printf '\n'
if [ "$FAIL" -gt 0 ]; then
  printf '\033[1;31m✗ ยังไม่พร้อม: ต้องแก้ %d ข้อ (เตือนอีก %d ข้อ)\033[0m\n' "$FAIL" "$WARN"
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  printf '\033[1;33m! พร้อมติดตั้งได้ แต่มี %d ข้อที่ควรจัดการ\033[0m\n' "$WARN"
else
  printf '\033[1;32m✓ พร้อมติดตั้ง — ไปต่อข้อ 2 (ตั้ง DNS) ของ docs/deploy.md\033[0m\n'
fi
