/**
 * ตรวจรูปแบบรายงานตามหัวข้อที่รอบส่งกำหนด (11/11/2569)
 *
 * ผู้ใช้: "อยากให้กดรายงานก็กดแบบเดิม แค่ให้มันจับว่ามีหัวข้อไหนบ้าง เป็นตามรูปแบบที่ตั้งไว้ไหม"
 * — ไม่เปลี่ยนวิธีพิมพ์/วางรายงาน ไม่มีช่องกรอกแยก แค่ดูว่าในข้อความมี "บรรทัดหัวข้อ" ครบตามที่รอบนั้นตั้งไว้
 * และ (ถ้ารอบนั้นบังคับ) แต่ละหัวข้อมีสีสถานะ 🔴🟡🟢 กำกับ
 *
 * จับด้วยกฎล้วน ๆ ไม่ใช้ AI: ผลเหมือนเดิมทุกครั้ง ทันที ไม่มีค่าใช้จ่าย (ทดลองแล้ว AI แยกหัวข้อจากข้อความ
 * เดียวกันได้ไม่เท่ากันในแต่ละครั้ง — ใช้ตัดสินว่า "ให้โพสต์ได้ไหม" ไม่ได้)
 *
 * บรรทัดหัวข้อ = บรรทัดที่ (หลังตัดอีโมจิ/เลขข้อ/สัญลักษณ์นำหน้า) ขึ้นต้นด้วยชื่อหัวข้อ
 * เทียบแบบไม่สนช่องว่าง เครื่องหมายวรรคตอน ตัวหนา/เอียง และตัวพิมพ์เล็กใหญ่
 */

export type StatusColor = "red" | "yellow" | "green";

export interface TopicCheck {
  topic: string;
  /** พบบรรทัดหัวข้อนี้ในข้อความ */
  found: boolean;
  /** สีที่กำกับหัวข้อนี้ (อีโมจิบนบรรทัดหัวข้อ) — null = ไม่ได้ใส่ */
  color: StatusColor | null;
  /** มีเนื้อหาใต้หัวข้อ (หรือต่อท้ายบนบรรทัดเดียวกัน) อย่างน้อย 1 ตัวอักษร */
  hasContent: boolean;
  /**
   * หัวส่วน เช่น 🏁Common Report🏁 / 🏁Department Module🏁 (ตั้งค่าโดยใส่ 🏁 ในบรรทัดหัวข้อ)
   * ไม่ต้องมีสี · "มีเนื้อหา" = มีอะไรก็ได้ต่อจากหัวส่วนจนถึงหัวส่วนถัดไป (รวมหัวข้อย่อยข้างใน)
   */
  section: boolean;
}

export interface FormatCheck {
  items: TopicCheck[];
  /** หัวข้อที่ยังไม่พบ */
  missing: string[];
  /** พบหัวข้อแล้วแต่ยังไม่ได้ใส่สี (เฉพาะเมื่อบังคับสี) */
  missingColor: string[];
  /** พบหัวข้อแล้วแต่ไม่มีเนื้อหา */
  empty: string[];
  ok: boolean;
}

const COLOR_OF: Record<string, StatusColor> = { "🔴": "red", "🟡": "yellow", "🟢": "green" };
export const COLOR_EMOJI: Record<StatusColor, string> = { red: "🔴", yellow: "🟡", green: "🟢" };

/** หัวข้อสูงสุดต่อรอบ / ความยาวสูงสุดต่อชื่อ / ชื่อเรียกอื่นสูงสุดต่อหัวข้อ — กันตั้งค่าจนตรวจไม่ไหวหรือแถบตรวจยาวล้นจอ */
export const MAX_TOPICS = 15;
export const MAX_TOPIC_LENGTH = 80;
export const MAX_ALIASES = 10;

/**
 * ชื่อเรียกอื่นของหัวข้อ — 1 บรรทัดในตั้งค่า = 1 หัวข้อ คั่นชื่อด้วย "|"
 *   "วันนี้ส่งงานอะไร | วันนี้ส่งงาน | งานที่ดำเนินการวันนี้"
 * ชื่อแรก = ชื่อหลัก (แสดงในแถบตรวจ และใช้ตอนกด "ใส่หัวข้อที่ขาดให้") ชื่อถัดไปนับว่าเป็นหัวข้อเดียวกัน
 * มีไว้เพราะรายงานจริงเขียนชื่อหัวข้อต่างกันเล็กน้อย (ทดลองกับรายงานจริง 24 ฉบับ 11/11/2569:
 * ชื่อตรงตัวผ่าน 7 · ใส่ชื่อเรียกอื่นที่พบบ่อยผ่าน 17)
 */
export function topicNames(line: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of line.split("|")) {
    const name = stripLead(part.replace(/[🔴🟡🟢]/gu, "")).trim().slice(0, MAX_TOPIC_LENGTH);
    const key = squash(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length > MAX_ALIASES) break;
  }
  return names;
}

/** บรรทัดตั้งค่าที่มี 🏁 = หัวส่วน (ไม่ต้องใส่สี) */
export function isSectionTopic(line: string): boolean {
  return line.includes("🏁");
}

/** ชื่อหลักของหัวข้อ (ชื่อแรกก่อน "|") */
export function topicLabel(line: string): string {
  return topicNames(line)[0] ?? "";
}

/**
 * รหัสจัดรูปแบบที่ตัวแก้ข้อความเก็บไว้ในเนื้อหา (lib/report-feed-rich-text.tsx):
 * สีตัวอักษร/ไฮไลต์/ขนาด `{{c:red}}…{{/c}}` `{{h:yellow}}…{{/h}}` `{{s:lg}}…{{/s}}` และแท็กคน `@[ชื่อ](user:id)`
 * ต้องตัดออกก่อนเทียบ — ไม่งั้นหัวข้อที่ทำตัวใหญ่/ใส่สีไว้จะกลายเป็น "slgวันนี้…" แล้วถูกนับว่าขาด
 * (เขียนซ้ำที่นี่แทนการ import จากไฟล์นั้น เพราะไฟล์นั้นเป็นคอมโพเนนต์ React ตัวตรวจนี้ต้องรันได้ทุกที่)
 */
function stripMarkup(s: string): string {
  let t = s;
  for (let i = 0; i < 4 && /\{\{\/?[chs](?::[a-z]+)?\}\}/.test(t); i++) t = t.replace(/\{\{\/?[chs](?::[a-z]+)?\}\}/g, "");
  return t.replace(/@\[([^\]]*)\]\([a-z]+:[^)]*\)/g, "@$1");
}

/** ตัดสิ่งที่ไม่ใช่ตัวหนังสือออกให้เทียบกันได้: ช่องว่าง วรรคตอน อีโมจิ สัญลักษณ์จัดรูปแบบ */
function squash(s: string): string {
  return stripMarkup(s)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\s.,:;!?…·•*_~`'"“”‘’()[\]{}<>/\\|—–\-=+#]/g, "");
}

/** เลขข้อ/สัญลักษณ์นำหน้าที่คนชอบใส่หน้าหัวข้อ: "1.", "1.2 —", "2)", "-", "•", "ข้อ 3" */
function stripLead(line: string): string {
  return stripMarkup(line).replace(/^\s*(?:[-–—•*▪◦>☐☑]+\s*)?(?:ข้อ\s*)?(?:\d+(?:[.．]\d+)*\s*[.):）\-–—]?\s*)?/u, "");
}

/** แปลงรายการหัวข้อที่พิมพ์มา (บรรทัดละหัวข้อ) ให้สะอาด ไม่ซ้ำ ไม่ว่าง ไม่เกินเพดาน */
export function normalizeTopics(input: readonly string[] | string | undefined | null): string[] {
  const raw = typeof input === "string" ? input.split(/\r?\n/) : (input ?? []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw) {
    const names = topicNames(String(line));
    const key = names[0] ? squash(names[0]) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const topic = names.join(" | ");
    out.push(topic);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/**
 * ตรวจข้อความรายงานกับหัวข้อที่กำหนด
 * @param text      ข้อความทั้งโพสต์ (หัวเรื่อง + เนื้อหา) แบบข้อความล้วน ขึ้นบรรทัดด้วย \n
 * @param topics    หัวข้อที่รอบนี้ต้องมี (ว่าง = ไม่ตรวจ ผ่านเสมอ)
 * @param requireColor บังคับสี 🔴🟡🟢 บนบรรทัดหัวข้อ
 */
export function checkReportFormat(text: string, topics: readonly string[], requireColor: boolean): FormatCheck {
  const wanted = normalizeTopics(topics);
  // ทุกชื่อ (หลัก + เรียกอื่น) ของทุกหัวข้อ เรียงชื่อยาวก่อน — "ปัญหา" ต้องไม่ไปแย่งบรรทัดของ "ปัญหาและความเสี่ยง"
  const byLength = wanted
    .flatMap((line, index) => topicNames(line).map((name) => ({ index, key: squash(name) })))
    .sort((a, b) => b.key.length - a.key.length);
  const items: TopicCheck[] = wanted.map((line) => ({ topic: topicLabel(line), found: false, color: null, hasContent: false, section: isSectionTopic(line) }));

  let current: TopicCheck | null = null;
  let currentSection: TopicCheck | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = squash(stripLead(line.replace(/[🔴🟡🟢🏁]/gu, "")));
    const hit = head ? byLength.find((t) => !items[t.index]!.found && head.startsWith(t.key)) : undefined;
    if (hit) {
      const item = items[hit.index]!;
      item.found = true;
      if (item.section) {
        // หัวส่วนใหม่ปิดหัวข้อเดิม — เนื้อหาใต้ "Department Module" ไม่ใช่รายละเอียดของหัวข้อสุดท้ายในส่วนก่อน
        currentSection = item;
        current = null;
        if (head.length > hit.key.length) item.hasContent = true;
        continue;
      }
      current = item;
      for (const emoji of Object.keys(COLOR_OF)) if (line.includes(emoji)) item.color = COLOR_OF[emoji]!;
      // เนื้อหาต่อท้ายบรรทัดเดียวกับหัวข้อ เช่น "🟢 วันนี้ส่งงานอะไร: ปิดงาน 4 ใบ"
      if (head.length > hit.key.length) item.hasContent = true;
      if (currentSection) currentSection.hasContent = true;
      continue;
    }
    // เส้นคั่น/จุดไข่ปลาที่ใช้เว้นบรรทัดไม่นับเป็นเนื้อหา
    if (!squash(line)) continue;
    if (current) current.hasContent = true;
    if (currentSection) currentSection.hasContent = true;
  }

  const missing = items.filter((i) => !i.found).map((i) => i.topic);
  const missingColor = requireColor ? items.filter((i) => i.found && !i.section && !i.color).map((i) => i.topic) : [];
  const empty = items.filter((i) => i.found && !i.hasContent).map((i) => i.topic);
  return { items, missing, missingColor, empty, ok: missing.length === 0 && missingColor.length === 0 && empty.length === 0 };
}

/** ข้อความหัวข้อเปล่าตามรูปแบบ — ปุ่ม "ใส่หัวข้อตามรูปแบบ" และไว้คัดลอกไปให้ AI เขียนตาม */
export function formatTemplate(topics: readonly string[], requireColor: boolean): string {
  return normalizeTopics(topics)
    .map((t) => (isSectionTopic(t) ? `${topicLabel(t)}\n` : `${requireColor ? "🟢" : ""}${topicLabel(t)}\n`))
    .join("\n");
}

/** ข้อความสั้นบอกว่ายังขาดอะไร — ใช้ข้างปุ่มโพสต์และใน title ของปุ่ม */
export function formatProblem(check: FormatCheck): string | null {
  if (check.ok) return null;
  if (check.missing.length > 0) return `ยังขาดหัวข้อ: ${check.missing.join(" · ")}`;
  if (check.missingColor.length > 0) return `ยังไม่ได้ใส่สี 🔴🟡🟢 หน้าหัวข้อ: ${check.missingColor.join(" · ")}`;
  return `ยังไม่มีรายละเอียดใต้หัวข้อ: ${check.empty.join(" · ")}`;
}
