/**
 * ข้อความคอมเมนต์ที่ "@ชื่อ" ของคนในบริษัทขึ้นเป็นสีเด่น (แบบแท็กในงาน/แชท) — แจ้งซ่อม 24/11/2569
 * "แท็กชื่อในใบงานเหมือนไม่ได้เมนชั่น สังเกตจากสีที่ไม่เด่นขึ้น"
 *
 * จับเฉพาะชื่อที่มีอยู่จริงในรายชื่อ (names) ชื่อยาวก่อน กัน "@สมชาย" ไปโดน "@สม" — กติกาเดียวกับ mentionedIn ฝั่งเซิร์ฟเวอร์
 * ไม่มี hook — ใช้ได้ทั้ง server และ client component
 */
export function MentionText({ text, names, className }: { text: string; names: string[]; className?: string }) {
  const sorted = [...new Set(names.filter((n) => n.trim()))].sort((a, b) => b.length - a.length);
  const parts: (string | { name: string })[] = [];
  let i = 0;
  let buf = "";
  while (i < text.length) {
    if (text[i] === "@") {
      const hit = sorted.find((n) => text.startsWith(n, i + 1));
      if (hit) {
        if (buf) parts.push(buf);
        buf = "";
        parts.push({ name: hit });
        i += hit.length + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) parts.push(buf);
  return (
    <p className={className ?? "whitespace-pre-wrap text-sm text-(--ink)"}>
      {parts.map((p, k) =>
        typeof p === "string" ? (
          p
        ) : (
          <span key={k} className="rounded-[4px] bg-(--app-soft,#ccfbf1) px-0.5 font-semibold text-(--app-strong,#0f766e)">
            @{p.name}
          </span>
        )
      )}
    </p>
  );
}
