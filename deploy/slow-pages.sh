#!/usr/bin/env bash
# หน้าไหนช้า — สรุปจาก log ของ Caddy (เก็บเวลาทุก request อยู่แล้ว ไม่ต้องติดตั้งอะไรเพิ่ม)
#
#   sudo bash deploy/slow-pages.sh          # 24 ชม. ล่าสุด
#   sudo bash deploy/slow-pages.sh 72       # 72 ชม. ล่าสุด
#
# แยก 2 ตาราง: "เปลี่ยนหน้า" (กดเมนู/ลิงก์ในแอป + เปิดหน้าตรง ๆ) กับ "API" (ข้อมูลที่หน้าโหลดตามมา)
# รวม path ที่ต่างกันแค่ id เข้าด้วยกัน (/maintenance/work-orders/abc → /maintenance/work-orders/:id)
set -euo pipefail
HOURS=${1:-24}
CONTAINER=$(docker ps --format '{{.Names}}' | grep -m1 caddy)

docker exec "$CONTAINER" sh -c 'cat /data/log/app*.log 2>/dev/null' | python3 -c '
import json, re, sys, time
hours = float(sys.argv[1]); since = time.time() - hours * 3600
ID = re.compile(r"/(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{20,}|c[a-z0-9]{20,}|\d+)(?=/|$)")
pages, apis = {}, {}
for line in sys.stdin:
    try: e = json.loads(line)
    except Exception: continue
    if e.get("ts", 0) < since: continue
    r = e.get("request", {}); uri = r.get("uri", ""); path = uri.split("?")[0]
    if path.startswith(("/_next/", "/api/realtime", "/api/files/")) or "." in path.rsplit("/", 1)[-1]: continue
    h = {k.lower(): v for k, v in (r.get("headers") or {}).items()}
    key = ID.sub("/:id", path) or "/"
    is_page = not path.startswith("/api/") and r.get("method") == "GET"
    if is_page and "_rsc=" not in uri and "rsc" not in h and "text/html" not in str(h.get("accept", "")): continue
    if not is_page:
        # แยกอ่าน/เขียน: อ่าน = GET ทั้งก้อน · อ่าน·เช็กรุ่น = เครื่องถือข้อมูลอยู่แล้ว (ได้ "ไม่เปลี่ยน" หรือแค่ส่วนที่เปลี่ยน) · เขียน = PUT/POST
        m = r.get("method", "GET")
        key = (("อ่าน·เช็กรุ่น " if "x-known-version" in h else "อ่าน ") if m == "GET" else f"เขียน({m}) ") + key
    (pages if is_page else apis).setdefault(key, []).append((float(e.get("duration", 0)), int(e.get("size", 0) or 0)))
def table(title, data):
    rows = []
    for k, pairs in data.items():
        v = sorted(d for d, _ in pairs); n = len(v)
        kb = sum(b for _, b in pairs) / n / 1024
        rows.append((v[n // 2], v[min(n - 1, int(n * 0.9))], v[-1], n, kb, k))
    rows.sort(reverse=True)
    print(f"\n== {title} (เรียงช้าสุดก่อน · วินาที · KB = ขนาดเฉลี่ยที่ส่งกลับ) ==")
    print("%6s %7s %7s %6s %7s  หน้า" % ("ปกติ", "ช้า10%", "ช้าสุด", "ครั้ง", "KB"))
    for med, p90, mx, n, kb, k in rows[:30]:
        if n >= 3: print(f"{med:6.2f} {p90:7.2f} {mx:7.2f} {n:6d} {kb:7.0f}  {k}")
table("เปลี่ยนหน้า", pages)
table("API", apis)
' "$HOURS"
