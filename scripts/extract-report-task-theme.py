"""
สกัดธีมของโมดูลรายงานและงานจาก globals.css ของแอป easyboss-workspace

รันซ้ำได้ทุกครั้งที่ดึงโค้ดเวอร์ชันใหม่ — จับด้วย "ชื่อโทเคน" ไม่ใช่ค่า
เพราะต้นทางเปลี่ยนค่าสีได้ (เช่น commit SmartBoss CI rebrand)

    python scripts/extract-report-task-theme.py <path-to-workspace-globals.css> <path-to-theme.css>
"""

import io
import re
import sys

SRC, DEST = sys.argv[1], sys.argv[2]

# โทเคนฐานที่ Smartboss เป็นเจ้าของ — ถ้าปล่อยไว้จะไปทับธีมของทุกโมดูล
OWNED = ("bg", "bg-soft", "ink", "ink-soft", "line", "radius", "brand-green", "brand-black")

HEADER = """/*
 * ธีมของโมดูลรายงานและงาน — สกัดจาก globals.css ของแอป easyboss-workspace
 *
 * ⚠ ไฟล์นี้สร้างด้วยสคริปต์ อย่าแก้มือ — ตอนดึงโค้ดเวอร์ชันใหม่ให้รัน
 *   python scratchpad/extract-theme.py <workspace>/src/app/globals.css \\
 *          apps/web/modules/report_task/theme.css
 *
 * สิ่งที่สคริปต์ทำ:
 *   1. ตัด @import ของ tailwind ออก — globals.css ของ Smartboss import ให้แล้ว
 *   2. ลบโทเคนฐาน (--bg/--ink/--line/--radius/--brand-*) เพราะ Smartboss เป็นเจ้าของ
 *   3. --primary/--ring/--accent เปลี่ยนจาก brand-green มาอิง --module-color
 *      ⇒ คอมโพเนนต์ shadcn เปลี่ยนสีตามโมดูลที่เปิดอยู่โดยอัตโนมัติ
 *   4. base layer ที่เดิมยิงใส่ `*` กับ `body` ถูกจำกัดให้อยู่ใน [data-app="report_task"]
 *
 * โทเคนของ shadcn ประกาศที่ :root โดยตั้งใจ ไม่ใช่ใน [data-app] เพราะ dialog/dropdown
 * ของ Base UI portal ออกไปที่ body ซึ่งอยู่นอก div ที่มี data-app
 */

"""

lines = io.open(SRC, encoding="utf-8").read().split("\n")

# ตัด @import ที่หัวไฟล์ (tailwind / tw-animate-css / shadcn)
while lines and lines[0].startswith("@import"):
    lines.pop(0)
while lines and lines[0].strip() == "":
    lines.pop(0)

owned_re = re.compile(r"^\s+--(" + "|".join(re.escape(n) for n in OWNED) + r"):")
text = "\n".join(l for l in lines if not owned_re.match(l))

# สีหลัก/โฟกัสริง/พื้นเน้น ต้องอิงสีประจำโมดูล
text = re.sub(r"^(\s+)--primary: var\(--brand-green\);", r"\1--primary: var(--module-color);", text, flags=re.M)
text = re.sub(r"^(\s+)--ring: var\(--brand-green\);", r"\1--ring: var(--module-color);", text, flags=re.M)
text = re.sub(r"^(\s+)--accent: (#[0-9a-fA-F]{3,8}|var\(--[a-z-]+\));", r"\1--accent: var(--module-color-bg);", text, flags=re.M)
text = re.sub(
    r"^(\s+)--accent-foreground: var\(--brand-green(-dark)?\);",
    r"\1--accent-foreground: var(--app-strong, var(--module-color));",
    text,
    flags=re.M,
)
text = re.sub(r"^(\s+)--destructive: oklch\([^)]*\);", r"\1--destructive: var(--danger);", text, flags=re.M)

# base layer ของต้นทางยิงใส่ `*` กับ `body` ทั้งหน้า — จำกัดให้อยู่ในโมดูล
text = re.sub(
    r"@layer base \{.*?\n\}",
    """@layer base {
  /* จำกัดไว้ในโมดูล — ของเดิมใช้ `*` กับ `body` ซึ่งจะไปทับธีมของทุกโมดูล */
  [data-app="report_task"] * {
    @apply border-border outline-ring/50;
  }
}""",
    text,
    count=1,
    flags=re.S,
)

io.open(DEST, "w", encoding="utf-8").write(HEADER + text.rstrip() + "\n")

# ตรวจผลลัพธ์ให้เห็นทันทีว่าไม่มีอะไรหลุด
leaked = [l for l in text.split("\n") if owned_re.match(l)]
print(f"เขียน {DEST} — {len(text.splitlines())} บรรทัด")
print("โทเคนฐานที่หลุดมา:", leaked if leaked else "ไม่มี")
