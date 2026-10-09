#!/usr/bin/env bash
# คืนคะแนน "ไม่ส่ง/ส่งรายงานช้า" ที่ระบบหักผิด — ทำแบบเดียวกับตอน CEO อนุมัติคำร้อง
# (decidePenaltyRequest ใน apps/web/modules/report_task/lib/db/report-penalty-requests.ts):
# ลงรายการคืน report_round_undo ของรอบเดิม วันเดิม คะแนนเท่าที่หักไปจริง ไม่ลบประวัติการหัก
#
#   sudo bash deploy/refund-report-penalty.sh "Surin" 2026-10-02 "โพสต์หายตอน deploy (ระบบผิด)"
#
#   ชื่อ  = ส่วนหนึ่งของชื่อหรืออีเมลในระบบ (ไม่สนตัวพิมพ์เล็กใหญ่)
#   วันที่ = วันที่โดนหัก ตามเวลาไทย (YYYY-MM-DD)
#
# occurred_at เก็บเป็นเวลา UTC แบบไม่มีโซน — ต้องบอกว่าเป็น UTC ก่อนแปลงเป็นเวลาไทย
# แสดงรายการที่เจอก่อน แล้วถามยืนยัน · รันซ้ำได้ ไม่คืนซ้ำ (ชนกุญแจกันซ้ำของตาราง = ข้าม)
set -euo pipefail
cd "$(dirname "$0")"

NAME=${1:?ใส่ชื่อ เช่น "Surin"}
DAY=${2:?ใส่วันที่ที่โดนหัก เช่น 2026-10-02}
REASON=${3:-ระบบหักผิด}
[[ "$DAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "วันที่ต้องเป็น YYYY-MM-DD" >&2; exit 1; }

MATCH="
  FROM core.performance_events e
  JOIN core.users u ON u.id = e.user_id
  WHERE e.source = 'report_task'
    AND e.category IN ('report_missed', 'report_late')
    AND e.ref_type = 'report_round'
    AND (u.name ILIKE '%' || :'name' || '%' OR u.email ILIKE '%' || :'name' || '%')
    AND ((e.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date = :'day'::date"

echo "── รายการหักคะแนนที่เจอ"
bash psql.sh -v name="$NAME" -v day="$DAY" <<SQL
SELECT u.name AS "พนักงาน", u.email AS "อีเมล", e.category AS "ชนิด", e.points AS "คะแนน",
       to_char((e.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS "วันที่หัก",
       EXISTS (SELECT 1 FROM core.performance_events r
               WHERE r.org_id = e.org_id AND r.source = e.source AND r.category = e.category
                 AND r.ref_type = 'report_round_undo' AND r.ref_id = e.ref_id) AS "คืนไปแล้ว"
$MATCH
ORDER BY e.occurred_at;
SQL

read -r -p "คืนคะแนนรายการที่ยังไม่ได้คืนข้างบนทั้งหมด? พิมพ์ y เพื่อยืนยัน: " ok
[ "$ok" = "y" ] || { echo "ยกเลิก ไม่ได้แก้อะไร"; exit 0; }

bash psql.sh -v name="$NAME" -v day="$DAY" -v reason="$REASON" <<SQL
INSERT INTO core.performance_events
  (id, org_id, user_id, source, category, points, occurred_at, ref_type, ref_id, note, created_by, created_at)
SELECT gen_random_uuid()::text, e.org_id, e.user_id, e.source, e.category, -e.points, e.occurred_at,
       'report_round_undo', e.ref_id, 'คืนคะแนน: ' || :'reason', NULL, now()
$MATCH
ON CONFLICT DO NOTHING;
SQL
echo "เสร็จ — เปิดหน้าคะแนนของพนักงานคนนั้นดูได้เลย (คะแนนคืนในเดือนเดียวกับที่หัก)"
