/**
 * ตรวจคำตอบ AI ก่อนแสดงผล (spec §6.4) — ฟังก์ชันล้วน ทดสอบได้จาก __tests__
 *
 *   1. parse ไม่ผ่าน → ผู้เรียกขอใหม่ 1 ครั้ง (parseAiOutput คืน null)
 *   2. entity_id ที่อ้างถึงต้องมีอยู่จริงในข้อมูลที่ส่งไป
 *   3. ตัวเลขใน executive_summary ต้องตรงกับค่าใน input
 *   4. คำแนะนำ "เพิ่มงบ" ห้ามชี้ไปที่แคมเปญที่ติดกฎ budget utilization
 *   5. ไม่ผ่าน 2–4 → ส่งกลับให้ AI แก้ 1 รอบ ยังไม่ผ่าน → ซ่อนส่วนนั้น (hideFailed)
 */

export type EntityType = "campaign" | "ad_group" | "keyword" | "account";

export interface AiOutput {
  executive_summary: string;
  top_performers: { entity_type: EntityType; entity_id: number | string | null; reason: string }[];
  underperformers: {
    entity_type: EntityType;
    entity_id: number | string | null;
    problem: string;
    recommendation: string;
  }[];
  previous_actions_review: { title: string; result: string }[];
  actions: {
    title: string;
    rationale: string;
    impact: "high" | "medium" | "low";
    urgency: "now" | "this_week" | "this_month";
    entity_type: EntityType;
    entity_id: number | string | null;
  }[];
}

export type Section = "executive_summary" | "top_performers" | "underperformers" | "actions";

export interface ValidationIssue {
  section: Section;
  index?: number;
  message: string;
}

const IMPACTS = new Set(["high", "medium", "low"]);
const URGENCIES = new Set(["now", "this_week", "this_month"]);

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Parse + ตรวจโครงตาม schema §6.3 — ไม่ผ่านคืน null */
export function parseAiOutput(raw: string | null | undefined): AiOutput | null {
  if (!raw) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || typeof obj.executive_summary !== "string" || !Array.isArray(obj.actions)) {
    return null;
  }
  return {
    executive_summary: obj.executive_summary,
    top_performers: arr<Record<string, unknown>>(obj.top_performers).map((x) => ({
      entity_type: str(x.entity_type) as EntityType,
      entity_id: (x.entity_id as number | string | null) ?? null,
      reason: str(x.reason),
    })),
    underperformers: arr<Record<string, unknown>>(obj.underperformers).map((x) => ({
      entity_type: str(x.entity_type) as EntityType,
      entity_id: (x.entity_id as number | string | null) ?? null,
      problem: str(x.problem),
      recommendation: str(x.recommendation),
    })),
    previous_actions_review: arr<Record<string, unknown>>(obj.previous_actions_review).map((x) => ({
      title: str(x.title),
      result: str(x.result),
    })),
    actions: arr<Record<string, unknown>>(obj.actions).map((x) => ({
      title: str(x.title),
      rationale: str(x.rationale),
      impact: (IMPACTS.has(str(x.impact)) ? x.impact : "medium") as AiOutput["actions"][number]["impact"],
      urgency: (URGENCIES.has(str(x.urgency)) ? x.urgency : "this_week") as AiOutput["actions"][number]["urgency"],
      entity_type: str(x.entity_type) as EntityType,
      entity_id: (x.entity_id as number | string | null) ?? null,
    })),
  };
}

/** สิ่งที่ตัวตรวจต้องรู้จาก input — ประกอบโดย data/ai.ts */
export interface ValidationContext {
  /** input JSON ทั้งก้อนที่ส่งให้ AI (ใช้เก็บตัวเลขที่อนุญาต) */
  input: unknown;
  entityIds: Record<Exclude<EntityType, "account">, Set<string>>;
  /** แคมเปญที่ budget_util_pct ต่ำกว่าเกณฑ์ — ห้ามแนะนำเพิ่มงบ */
  budgetBlockedCampaignIds: Set<string>;
}

const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const DATE_RE = /\d{4}-\d{2}-\d{2}/g;

function numbersIn(text: string): number[] {
  return (text.match(NUMBER_RE) ?? []).map((s) => Number(s.replace(/,/g, "")));
}

/** ทุกตัวเลขที่ "มีอยู่ใน input" — ค่าตัวเลข ตัวเลขในข้อความ (เช่นชื่อแคมเปญ) ความยาว array ส่วนประกอบวันที่ */
export function allowedNumbers(input: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string") {
      for (const d of v.match(DATE_RE) ?? []) {
        const [y, m, day] = d.split("-").map(Number) as [number, number, number];
        out.push(y, y + 543, m, day);
      }
      out.push(...numbersIn(v.replace(DATE_RE, " ")));
    } else if (Array.isArray(v)) {
      out.push(v.length);
      v.forEach(walk);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  return out;
}

function matches(found: number, allowed: number[]): boolean {
  return allowed.some((a) => {
    const abs = Math.abs(a);
    if (Math.abs(found - abs) < 1e-9) return true;
    // ปัดเศษแบบที่คนเขียนสรุปใช้กัน (0–2 ตำแหน่ง) — ต้องตรงกับค่าปัดของตัวเลขใน input
    return [0, 1, 2].some((d) => {
      const f = 10 ** d;
      return Math.abs(found - Math.round(abs * f) / f) < 1e-9;
    });
  });
}

export const INCREASE_BUDGET_RE =
  /เพิ่ม\s*(?:งบ|budget)|ขยาย\s*งบ|อัด\s*งบ|increase\s+(?:the\s+)?(?:daily\s+)?budget|raise\s+(?:the\s+)?budget/i;

export function validateAiOutput(out: AiOutput, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const idOk = (type: EntityType, id: number | string | null) => {
    if (type === "account") return true;
    const set = ctx.entityIds[type as Exclude<EntityType, "account">];
    return !!set && id != null && set.has(String(id));
  };

  // 2) entity_id ต้องมีอยู่จริง
  (["top_performers", "underperformers", "actions"] as const).forEach((section) => {
    out[section].forEach((item, index) => {
      if (!idOk(item.entity_type, item.entity_id)) {
        issues.push({
          section,
          index,
          message: `${section}[${index}] อ้าง ${item.entity_type} id ${item.entity_id} ที่ไม่มีในข้อมูลที่ส่งไป`,
        });
      }
    });
  });

  // 3) ตัวเลขในบทสรุปต้องมาจาก input
  const allowed = allowedNumbers(ctx.input);
  const summaryNumbers = numbersIn(out.executive_summary.replace(DATE_RE, " "));
  const unknown = summaryNumbers.filter((n) => !matches(n, allowed));
  if (unknown.length > 0) {
    issues.push({
      section: "executive_summary",
      message: `executive_summary มีตัวเลขที่ไม่อยู่ในข้อมูลที่ส่งไป: ${[...new Set(unknown)].join(", ")}`,
    });
  }

  // 4) ห้ามแนะนำเพิ่มงบให้แคมเปญที่ใช้งบไม่ถึงเกณฑ์
  const blocked = (type: EntityType, id: number | string | null) =>
    type === "campaign" && id != null && ctx.budgetBlockedCampaignIds.has(String(id));
  out.actions.forEach((a, index) => {
    if (blocked(a.entity_type, a.entity_id) && INCREASE_BUDGET_RE.test(`${a.title} ${a.rationale}`)) {
      issues.push({
        section: "actions",
        index,
        message: `actions[${index}] แนะนำเพิ่มงบให้แคมเปญ ${a.entity_id} ซึ่ง budget_util_pct ต่ำกว่าเกณฑ์`,
      });
    }
  });
  out.underperformers.forEach((u, index) => {
    if (blocked(u.entity_type, u.entity_id) && INCREASE_BUDGET_RE.test(u.recommendation)) {
      issues.push({
        section: "underperformers",
        index,
        message: `underperformers[${index}] แนะนำเพิ่มงบให้แคมเปญ ${u.entity_id} ซึ่ง budget_util_pct ต่ำกว่าเกณฑ์`,
      });
    }
  });

  return issues;
}

export interface HiddenPart {
  section: Section;
  index?: number;
  reason: string;
}

/** ซ่อนส่วนที่ยังไม่ผ่านหลังให้ AI แก้แล้ว 1 รอบ (§6.4 ข้อ 5) */
export function hideFailed(out: AiOutput, issues: ValidationIssue[]): { output: AiOutput; hidden: HiddenPart[] } {
  const drop = (section: Section) => new Set(issues.filter((i) => i.section === section && i.index != null).map((i) => i.index));
  const dropTop = drop("top_performers");
  const dropUnder = drop("underperformers");
  const dropActions = drop("actions");
  const summaryFailed = issues.some((i) => i.section === "executive_summary");
  return {
    output: {
      ...out,
      executive_summary: summaryFailed ? "" : out.executive_summary,
      top_performers: out.top_performers.filter((_, i) => !dropTop.has(i)),
      underperformers: out.underperformers.filter((_, i) => !dropUnder.has(i)),
      actions: out.actions.filter((_, i) => !dropActions.has(i)),
    },
    hidden: issues.map((i) => ({ section: i.section, index: i.index, reason: i.message })),
  };
}
