/**
 * จัดหมวดตั๋วแจ้งบัคตาม "แจ้งมาจากโมดูลไหน › เมนูไหน" จาก pageUrl ที่เก็บไว้ในทุกตั๋ว
 * อยู่แล้ว (IssueTicket.context.pageUrl) — ไม่ต้องย้ายข้อมูลเก่า ตั๋วเก่าถูกจัดหมวด
 * ย้อนหลังอัตโนมัติ ไฟล์นี้ไม่ import อะไรเลยเพื่อให้เทสต์ตรง ๆ ได้ (รับรายการโมดูล
 * เข้ามาเป็นพารามิเตอร์ ตัวหน้าส่ง moduleRegistry ให้)
 */

export interface SourceModule {
  id: string;
  name: string;
  color: string;
  icon: string;
  basePath: string;
  menus: { label: string; path: string }[];
}

export interface IssueSource {
  moduleId: string;
  moduleName: string;
  color: string;
  icon: string;
  /** null = จับคู่เมนูไม่ได้ (เช่น หน้าย่อยที่ไม่อยู่ในเมนู) */
  menuPath: string | null;
  menuLabel: string | null;
  /** พาธเต็มของหน้าที่แจ้ง ถ้าเป็นหน้ารายการเดี่ยว (…/work-orders/[id]) ไว้เปิดตรงไปที่นั่น */
  recordPath: string | null;
}

export const OTHER_MODULE_ID = "other";

/** โมดูลที่ชื่อซ้ำกัน (แจ้งบัคของ user กับของ admin) รวมเป็นหมวดเดียว */
const MODULE_ALIAS: Record<string, string> = { issue_report_self: "admin_issue_report" };

/** พาธเดิมของหน้าแจ้งบัคก่อนย้ายออกจากรายงานและงาน — ตั๋วเก่ายังเก็บพาธนี้ไว้ */
const LEGACY_PREFIXES: [string, string][] = [["/report-task/issue-reports", "/issue-reports"]];

const NON_RECORD_SEGMENTS = new Set(["new", "edit", "create"]);

export function normalizePageUrl(pageUrl: string | null | undefined): string {
  let p = (pageUrl ?? "").trim();
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    // ปล่อยผ่าน ใช้ค่าดิบต่อ
  }
  p = p.split(/[?#]/)[0] ?? "";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  for (const [from, to] of LEGACY_PREFIXES) {
    if (p === from || p.startsWith(`${from}/`)) p = to + p.slice(from.length);
  }
  return p;
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function classifyIssueSource(pageUrl: string | null | undefined, modules: SourceModule[]): IssueSource {
  const path = normalizePageUrl(pageUrl);
  const mod = [...modules].sort((a, b) => b.basePath.length - a.basePath.length).find((m) => under(path, m.basePath));

  if (!mod) {
    return {
      moduleId: OTHER_MODULE_ID,
      moduleName: "อื่น ๆ / ไม่ทราบหน้า",
      color: "#94a3b8",
      icon: "Ellipsis",
      menuPath: null,
      menuLabel: path === "/" ? "หน้าหลัก" : null,
      recordPath: null,
    };
  }

  // เมนู "แดชบอร์ด" (path = basePath) ตรงเฉพาะหน้าแรกของโมดูลพอดี ไม่ใช่ทุกหน้าย่อย
  const menu = [...mod.menus]
    .sort((a, b) => b.path.length - a.path.length)
    .find((m) => (m.path === mod.basePath ? path === m.path : under(path, m.path)));

  const remainder = menu && path.length > menu.path.length ? path.slice(menu.path.length + 1).split("/") : [];
  const isRecord = remainder.length === 1 && !NON_RECORD_SEGMENTS.has(remainder[0]!);

  return {
    moduleId: MODULE_ALIAS[mod.id] ?? mod.id,
    moduleName: mod.name,
    color: mod.color,
    icon: mod.icon,
    menuPath: menu?.path ?? null,
    menuLabel: menu?.label ?? null,
    recordPath: isRecord ? path : null,
  };
}
