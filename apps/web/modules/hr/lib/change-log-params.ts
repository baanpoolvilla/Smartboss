import { hasPermission, hasRole, isSuperAdmin, type OrgSession } from "@smartboss/auth";
import { HR_PERMS } from "@/modules/hr/permissions";
import { CHANGE_CATEGORIES, type ChangeCategory } from "./change-log-text";

/** ใครเห็น Log การบันทึกระบบบุคคล — Boss + คนที่มีสิทธิ์ตั้งค่าระบบบุคคล (ผู้ใช้เลือก 27/11/2569) */
export function canSeeHrLog(session: OrgSession): boolean {
  return hasPermission(session, HR_PERMS.settingManage) || hasRole(session, "CEO") || isSuperAdmin(session);
}

export interface HrLogParams {
  fromYmd: string;
  toYmd: string;
  from: Date;
  /** ไม่รวม — วันถัดจาก toYmd 00:00 เวลาไทย */
  to: Date;
  category: ChangeCategory | "all";
  actor: string;
  target: string;
  q: string;
  includeCheckins: boolean;
  limit: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function bkkYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

/** ?from=&to=&cat=&actor=&emp=&q=&checkins=1&n= → ค่าที่ใช้ (ค่าเริ่ม: 30 วันล่าสุด) */
export function parseHrLogParams(sp: Record<string, string | string[] | undefined>): HrLogParams {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const today = bkkYmd(new Date());
  let toYmd = YMD.test(one("to")) ? one("to") : today;
  let fromYmd = YMD.test(one("from")) ? one("from") : bkkYmd(new Date(Date.parse(`${toYmd}T00:00:00+07:00`) - 29 * DAY));
  if (fromYmd > toYmd) [fromYmd, toYmd] = [toYmd, fromYmd];
  // ไม่เกิน 1 ปีต่อครั้ง — กันหน้าหนักเกิน
  const maxFrom = bkkYmd(new Date(Date.parse(`${toYmd}T00:00:00+07:00`) - 365 * DAY));
  if (fromYmd < maxFrom) fromYmd = maxFrom;
  const cat = one("cat");
  const n = Number(one("n"));
  return {
    fromYmd,
    toYmd,
    from: new Date(`${fromYmd}T00:00:00+07:00`),
    to: new Date(Date.parse(`${toYmd}T00:00:00+07:00`) + DAY),
    category: cat in CHANGE_CATEGORIES ? (cat as ChangeCategory) : "all",
    actor: one("actor"),
    target: one("emp"),
    q: one("q").slice(0, 100),
    includeCheckins: one("checkins") === "1" || cat === "checkin",
    limit: Number.isInteger(n) && n > 0 ? Math.min(n, 2000) : 100,
  };
}

/** สร้าง query string ใหม่จากค่าปัจจุบัน + ที่เปลี่ยน */
export function hrLogHref(p: HrLogParams, change: Partial<Record<"from" | "to" | "cat" | "actor" | "emp" | "q" | "checkins" | "n", string>>, base = "/hr/log"): string {
  const cur: Record<string, string> = {
    from: p.fromYmd,
    to: p.toYmd,
    cat: p.category === "all" ? "" : p.category,
    actor: p.actor,
    emp: p.target,
    q: p.q,
    checkins: p.includeCheckins ? "1" : "",
  };
  const merged = { ...cur, ...change };
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined && v !== ""));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}
