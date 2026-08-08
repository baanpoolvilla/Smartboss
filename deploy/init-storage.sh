#!/usr/bin/env bash
# สร้างถังเก็บไฟล์ใน MinIO — รันหลัง docker compose up
#
#   sudo bash deploy/init-storage.sh
#
# เรียกซ้ำได้ ถังที่มีอยู่แล้วจะไม่ถูกแตะ
set -euo pipefail

COMPOSE_ENV=${COMPOSE_ENV:-/opt/smartboss/deploy/.env}
BUCKET=${BUCKET:-smartboss}

[ -r "$COMPOSE_ENV" ] || { echo "อ่าน $COMPOSE_ENV ไม่ได้" >&2; exit 1; }
set -a; . "$COMPOSE_ENV"; set +a
: "${MINIO_ROOT_USER:?ไม่มี MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?ไม่มี MINIO_ROOT_PASSWORD}"

# ส่งข้อมูลเข้าสู่ระบบผ่าน MC_HOST_<alias> จากฝั่งโฮสต์
#
# ⚠ ห้ามเขียนเป็น  mc alias set local http://... "$MINIO_ROOT_USER" ...  ในสตริง
#   ที่ถูกรันในคอนเทนเนอร์ เพราะตัวแปรจะถูกขยายข้างในซึ่งไม่มีค่า กลายเป็นล็อกอิน
#   ด้วยชื่อว่าง แล้วขึ้น error ที่อ่านแล้วไม่รู้ว่าสาเหตุคืออะไร
MC="docker run --rm --network host
    -e MC_HOST_local=http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@127.0.0.1:9000
    minio/mc"

echo "── รอ MinIO พร้อมรับคำสั่ง ──"
for i in $(seq 1 30); do
  if $MC ls local >/dev/null 2>&1; then break; fi
  [ "$i" = 30 ] && { echo "ต่อ MinIO ไม่ได้ — ตรวจ: docker compose -f deploy/docker-compose.yml logs minio" >&2; exit 1; }
  sleep 2
done

echo "── สร้างถัง $BUCKET ──"
$MC mb --ignore-existing "local/$BUCKET"

# ปิดการเข้าถึงแบบไม่ล็อกอินให้ชัดเจน — ทุกไฟล์ต้องมาพร้อม presigned URL
# ที่เว็บเซ็นให้ อายุ 5 นาที ถ้าเผลอเปิดสาธารณะ ใครเดา key ถูกก็โหลดสลิปเงินเดือนได้
echo "── ปิดการเข้าถึงสาธารณะ ──"
$MC anonymous set none "local/$BUCKET"

echo "── ผลลัพธ์ ──"
$MC ls local
$MC anonymous get "local/$BUCKET"

echo ""
echo "เรียบร้อย — ถัง $BUCKET พร้อมใช้งานและไม่เปิดสาธารณะ"
