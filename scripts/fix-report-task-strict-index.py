"""
ปรับโค้ดที่ยกมาจาก easyboss-workspace ให้ผ่าน noUncheckedIndexedAccess ของ Smartboss

ต้นทางไม่ได้เปิดแฟล็กนี้ ทุกครั้งที่ดึงโค้ดใหม่จะได้ error ชุดเดิมกลับมา
สคริปต์นี้ใส่ non-null assertion เฉพาะจุดที่พิสูจน์แล้วว่าดัชนีอยู่ในช่วงเสมอ
(อยู่ในลูปที่คุมด้วย .length / มาจาก regex ที่ match แน่นอน / อาร์เรย์ค่าคงที่)

    python scripts/fix-report-task-strict-index.py <repo-root>

รันซ้ำได้ ไม่ใส่ ! ซ้อน
"""

import io
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
M = ROOT / "apps/web/modules/report_task"
PAGES = ROOT / "apps/web/app/(shell)/report-task"

# (ไฟล์, ข้อความเดิม, ข้อความใหม่) — ใช้ replace ตรงตัวเพื่อไม่ให้ไปโดนที่อื่น
EXACT = [
    ("data/mock.ts",
     "const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];",
     "// อาร์เรย์ที่ส่งเข้ามาเป็นค่าคงที่ในไฟล์นี้ ไม่มีทางว่าง\n"
     "const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] as T;"),
    ("data/mock.ts",
     "    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);",
     "    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0] as T);"),
    ("data/mock.ts",
     "const pickN = <T,>(arr: T[], n: number) => {",
     "const pickN = <T,>(arr: T[], n: number): T[] => {"),
    ("data/mock.ts", "return dept ? dept.headId : users[0].id;", "return dept ? dept.headId : users[0]!.id;"),
    ("data/mock.ts",
     "  const status = i < 6 ? statuses[i % statuses.length] : pick(statuses);",
     "  const status = i < 6 ? statuses[i % statuses.length]! : pick(statuses);"),

    ("lib/report-feed-rich-text.tsx", "if (m[2] === type) ids.add(m[3]);", "if (m[2] === type) ids.add(m[3]!);"),
    ("lib/report-feed-rich-text.tsx", "el.childNodes[0].nodeType", "el.childNodes[0]!.nodeType"),
    ("lib/report-feed-rich-text.tsx", "(el.childNodes[0] as HTMLElement)", "(el.childNodes[0]! as HTMLElement)"),
    ("lib/report-feed-rich-text.tsx", 'if (lines[i].trim() === "" && i > 0) i--;', 'if (lines[i]!.trim() === "" && i > 0) i--;'),
    ("lib/report-feed-rich-text.tsx", "parseInt(match[1], 10) + 1 : 1;", "parseInt(match[1]!, 10) + 1 : 1;"),
    ("lib/report-feed-rich-text.tsx", "const line = bullets[i];", "const line = bullets[i]!;"),
    ("lib/report-feed-rich-text.tsx", "const [header, ...body] = rows;", "const [header = [], ...body] = rows;"),

    ("lib/ssrf-guard.ts", "  const [a, b] = parts;",
     "  // เช็ค parts.length !== 4 ไปแล้วบรรทัดบน — ยืนยันชนิดให้ TS ตามทัน\n"
     "  const [a, b] = parts as [number, number, number, number];"),

    ("lib/leave-quota.ts", '  const [y, m] = ym.split("-").map(Number);',
     '  // ym มาจาก ymKey() เสมอ จึงเป็น "YYYY-MM" ที่แยกได้ 2 ส่วนแน่นอน\n'
     '  const [y, m] = ym.split("-").map(Number) as [number, number];'),
    ("lib/leave-quota.ts", '      const [ey, em] = upcoming.expiryKey.split("-").map(Number);',
     '      const [ey, em] = upcoming.expiryKey.split("-").map(Number) as [number, number];'),
    ("lib/leave-quota.ts", '      const [ay, am] = asOfKey.split("-").map(Number);',
     '      const [ay, am] = asOfKey.split("-").map(Number) as [number, number];'),

    ("lib/department-label.ts", "getDepartment(unique[0])?.name", "getDepartment(unique[0]!)?.name"),

    ("components/shared/tour-overlay.tsx", "      const startEl = dayCells[startIndex];\n      const endEl = dayCells[endIndex];",
     "      // index ทั้งคู่มาจาก indexOf/clamp กับ dayCells ชุดเดียวกัน จึงอยู่ในช่วงเสมอ\n"
     "      const startEl = dayCells[startIndex]!;\n      const endEl = dayCells[endIndex]!;"),

    ("components/report-feed/report-post-fields.tsx", "  const currentLine = lines[lines.length - 1];",
     "  // split() คืนอย่างน้อยหนึ่งสมาชิกเสมอ แม้สตริงว่าง\n  const currentLine = lines[lines.length - 1]!;"),
    ("components/report-feed/report-post-fields.tsx", "return { query: match[1], rect,", "return { query: match[1]!, rect,"),
    ("components/report-feed/report-post-fields.tsx", "currentLine.trim() === match[0].trim()", "currentLine.trim() === match[0]!.trim()"),

    ("components/calendar/leave-type-settings-dialog.tsx", '  const [y, m] = monthKey.split("-").map(Number);',
     '  // monthKey เป็นรูปแบบ "YYYY-MM" ที่ระบบสร้างเอง\n'
     '  const [y, m] = monthKey.split("-").map(Number) as [number, number];'),
    ("components/calendar/leave-type-settings-dialog.tsx", "createElement(leaveIconRegistry[name],",
     "createElement(leaveIconOf(name),"),
    ("components/calendar/leave-sidebar.tsx", '    const [y, m] = pillMonth.split("-").map(Number);',
     '    // pillMonth เป็นรูปแบบ "YYYY-MM" ที่โค้ดนี้สร้างเอง\n'
     '    const [y, m] = pillMonth.split("-").map(Number) as [number, number];'),

    ("components/kanban/new-task-dialog.tsx", "allowedTypes.includes(rawType) ? rawType : allowedTypes[0];",
     "allowedTypes.includes(rawType) ? rawType : allowedTypes[0]!;"),

    ("components/dashboard/escalations-panel.tsx", "getUser(t.assigneeIds[0])", 'getUser(t.assigneeIds[0] ?? "")'),
    ("components/dashboard/upcoming-deadlines.tsx", "getUser(t.assigneeIds[0])", 'getUser(t.assigneeIds[0] ?? "")'),
    ("components/dashboard/my-tasks.tsx", "getUser(t.assigneeIds[0])", 'getUser(t.assigneeIds[0] ?? "")'),
    ("components/calendar/people-calendar-list.tsx", "colorPalette[index % colorPalette.length].value",
     "colorPalette[index % colorPalette.length]!.value"),
    ("components/report-feed/topic-sidebar.tsx", "departmentIcon[deptIds[0]]", 'departmentIcon[deptIds[0] ?? ""]'),
    ("components/report-feed/topic-sidebar.tsx", "useState(topicColors[0])", "useState(topicColors[0]!)"),
    ("components/report-feed/topic-sidebar.tsx", "setColor(topicColors[topics.length % topicColors.length])",
     "setColor(topicColors[topics.length % topicColors.length]!)"),

    ("store/dashboard-layout-store.ts", "next.splice(to, 0, moved);", "next.splice(to, 0, moved!);"),
    ("store/report-layout-store.ts", "next.splice(to, 0, moved);", "next.splice(to, 0, moved!);"),
    ("store/google-calendar-store.ts", "state.linksByUser[userId] = state.linksByUser[userId].map((l) =>",
     "state.linksByUser[userId] = (state.linksByUser[userId] ?? []).map((l) =>"),
    ("store/holiday-store.ts", 'h.id.split("-")[1] : THAI_SOURCE;', '(h.id.split("-")[1] ?? THAI_SOURCE) : THAI_SOURCE;'),
    ("store/task-store.ts", "matching[0].title, matching[0].id", "matching[0]!.title, matching[0]!.id"),
    ("store/report-feed-store.ts", "color: topicColors[0],", "color: topicColors[0]!,"),
    ("store/report-feed-store.ts", "data.color ?? topicColors[s.topics.length % topicColors.length],",
     "data.color ?? topicColors[s.topics.length % topicColors.length]!,"),

    # ── รอบดึงโค้ด 2026-08-04 (Report Phase 1-7) ──
    ("components/kanban/task-grid.tsx", "groupValue(pagedRows[i - 1])", "groupValue(pagedRows[i - 1]!)"),
    # report-card ใช้ images[0] หลายที่ — จัดการด้วย REGEX ด้านล่างแทน
    ("components/report-feed/report-post-fields.tsx",
     "albumId={images.every((img) => img.albumId === images[0].albumId) ? images[0].albumId : undefined}",
     "albumId={images.every((img) => img.albumId === images[0]!.albumId) ? images[0]!.albumId : undefined}"),
    ("components/shared/org-settings-panel.tsx", "colorPalette[d.length % colorPalette.length].v",
     "colorPalette[d.length % colorPalette.length]!.v"),
    ("components/shared/org-settings-panel.tsx", "departmentId: departments[0].id,", "departmentId: departments[0]!.id,"),
    ("lib/report-feed-compliance.ts", "matches.length === 1 ? matches[0].id : null;", "matches.length === 1 ? matches[0]!.id : null;"),
    ("store/report-feed-store.ts", '{ id: "topic-general-announce", name: "ประกาศทั่วไป", color: topicColors[1],',
     '{ id: "topic-general-announce", name: "ประกาศทั่วไป", color: topicColors[1]!,'),
]

# (ไฟล์, regex, ตัวแทน) — ใช้กับที่ซ้ำหลายจุดในไฟล์เดียว
REGEX = [
    ("lib/report-feed-rich-text.tsx", r"bullets\[i\](?!!)", "bullets[i]!"),
    ("lib/report-cutoff.ts", r'const \[h, m\] = c\.time\.split\(":"\)\.map\(Number\);(?! as)',
     'const [h, m] = c.time.split(":").map(Number) as [number, number];'),
    ("lib/report-feed-compliance.ts", r'const \[h, m\] = c\.time\.split\(":"\)\.map\(Number\);(?! as)',
     'const [h, m] = c.time.split(":").map(Number) as [number, number];'),
    ("lib/task-penalty-sweep.test.ts", r"result\.tasks\[0\](?!!)", "result.tasks[0]!"),
    ("components/shared/tour-overlay.tsx", r"dayCells\[i\](?!!)", "dayCells[i]!"),
    ("components/shared/tour-overlay.tsx", r"dayCells\[endIndex\](?!!)", "dayCells[endIndex]!"),
    ("components/report-feed/report-card.tsx", r"img=\{images\[0\]\}", "img={images[0]!}"),
    ("components/report-feed/report-post-fields.tsx", r"parseInt\(numberedMatch\[1\], 10\)", "parseInt(numberedMatch[1]!, 10)"),
]

applied, missing = 0, []

for rel, old, new in EXACT:
    p = M / rel
    if not p.exists():
        missing.append(f"{rel} (ไม่มีไฟล์)")
        continue
    s = io.open(p, encoding="utf-8").read()
    if new.split("\n")[-1] in s and old not in s:
        continue  # แก้ไปแล้ว
    if old not in s:
        missing.append(f"{rel}: {old[:60]}")
        continue
    io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
    applied += 1

for rel, pat, rep in REGEX:
    p = M / rel
    if not p.exists():
        missing.append(f"{rel} (ไม่มีไฟล์)")
        continue
    s = io.open(p, encoding="utf-8").read()
    s2 = re.sub(pat, rep, s)
    if s2 != s:
        io.open(p, "w", encoding="utf-8").write(s2)
        applied += 1

# หน้า settings ใช้ currentSections[0] โดยเช็ค length ไปแล้ว
sp = PAGES / "settings/page.tsx"
if sp.exists():
    s = io.open(sp, encoding="utf-8").read()
    if "currentSections[0].key" in s:
        io.open(sp, "w", encoding="utf-8").write(s.replace("currentSections[0].key", "currentSections[0]!.key"))
        applied += 1

print(f"แก้ {applied} จุด")
if missing:
    print("หาไม่เจอ (ต้นทางอาจเปลี่ยนโค้ด — ต้องไล่ดูเอง):")
    for m in missing:
        print("  -", m)
