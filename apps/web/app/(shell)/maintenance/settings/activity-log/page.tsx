import Link from "next/link";
import { redirect } from "next/navigation";
import { History, ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import {
  ACTION_LABELS,
  ACTIVITY_PAGE_SIZE,
  ENTITY_LABELS,
  activityActors,
  listActivity,
  type ActivityEntity,
  type ActivityKind,
} from "@/modules/maintenance/data/activity";
import { userNameMap } from "@/modules/maintenance/data/users";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

export const dynamic = "force-dynamic";

/** ใครเปิดหน้านี้ได้ — Super admin กับ CEO (ตรงกับ onlyForRoles ของเมนูใน manifest.ts) */
const ACTIVITY_LOG_ROLES = ["SUPER_ADMIN", "CEO"];

const ACTION_TONE: Record<ActivityKind, string> = {
  create: "bg-[#ECFDF5] text-[#047857]",
  update: "bg-[#EFF6FF] text-[#1D4ED8]",
  delete: "bg-[#FEF2F2] text-[#B91C1C]",
  status: "bg-[#FFF7ED] text-[#C2410C]",
  comment: "bg-[#F5F3FF] text-[#6D28D9]",
  other: "bg-(--bg-soft) text-(--ink-soft)",
};

/** ลิงก์ไปของที่ถูกแตะ (ถ้ายังเปิดดูได้) — ของที่ถูกลบไปแล้วจะเข้าไม่ได้ แต่บันทึกยังอยู่ */
function hrefFor(entity: string, id: string | null, action: string): string | null {
  if (!id || action === "delete") return null;
  switch (entity) {
    case "work_order":
      return `/maintenance/work-orders/${id}`;
    case "purchase_order":
    case "return":
      return `/maintenance/purchase-orders/${id}`;
    case "property":
      return `/maintenance/properties/${id}`;
    case "asset":
      return `/maintenance/assets/${id}`;
    case "contractor":
      return `/maintenance/contractors/${id}`;
    case "pm":
      return "/maintenance/pm";
    default:
      return null;
  }
}

const BKK = "Asia/Bangkok";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: BKK }).format(d);
const dayLabel = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: BKK, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
const timeLabel = (d: Date) => new Intl.DateTimeFormat("th-TH", { timeZone: BKK, hour: "2-digit", minute: "2-digit" }).format(d);
const parseDay = (v: string | undefined, endOfDay = false) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00+07:00`);
  if (endOfDay) d.setUTCDate(d.getUTCDate() + 1);
  return d;
};

/** detail (JSON) → บรรทัด "ช่อง: ค่า" อ่านง่าย · ค่าที่เป็น {from,to} แสดงเป็น ก่อน → หลัง */
function detailLines(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const show = (v: unknown): string => {
    if (v === null || v === undefined || v === "") return "-";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v) {
        const ft = v as { from: unknown; to: unknown };
        return `${k}: ${show(ft.from)} → ${show(ft.to)}`;
      }
      return `${k}: ${show(v)}`;
    });
}

/**
 * Log การใช้งานโมดูลแจ้งซ่อมบำรุง — ใครทำอะไร กับอะไร เมื่อไหร่ (ทุก server action ของโมดูลเขียนลง
 * maintenance.activity_logs ผ่าน logActivity) · เห็นเฉพาะ Super admin / CEO
 */
export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; entity?: string; from?: string; to?: string; q?: string; page?: string }>;
}) {
  const session = await requireOrg();
  if (!isSuperAdmin(session) && !session.roles.some((r) => ACTIVITY_LOG_ROLES.includes(r))) redirect("/maintenance");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const entity = sp.entity && sp.entity in ENTITY_LABELS ? sp.entity : undefined;

  const [{ rows, total }, actorIds] = await Promise.all([
    listActivity(
      session.orgId,
      { userId: sp.user || undefined, entity, from: parseDay(sp.from), to: parseDay(sp.to, true), q: sp.q?.trim() || undefined },
      page
    ),
    activityActors(session.orgId),
  ]);
  const names = await userNameMap(session.orgId, [...actorIds, ...rows.map((r) => r.userId)]);
  const actors = actorIds.map((id) => ({ id, name: names[id] ?? "ผู้ใช้" })).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));

  const groups: { key: string; label: string; items: typeof rows }[] = [];
  for (const r of rows) {
    const key = dayKey(r.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, label: dayLabel(r.createdAt), items: [r] });
  }

  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  const filtered = !!(sp.user || entity || sp.from || sp.to || sp.q);
  const field = "rounded-(--radius) border border-(--line) bg-(--bg) px-2.5 py-2 text-sm";

  return (
    <AppScaffold title="Log การใช้งาน" width="max-w-4xl" backHref="/maintenance/settings">
      <form method="get" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <select id="al-user" name="user" defaultValue={sp.user ?? ""} className={`${field} col-span-2 sm:col-span-2`} aria-label="คน">
          <option value="">ทุกคน</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select id="al-entity" name="entity" defaultValue={entity ?? ""} className={`${field} col-span-2 sm:col-span-2`} aria-label="ประเภท">
          <option value="">ทุกเมนู</option>
          {(Object.keys(ENTITY_LABELS) as ActivityEntity[]).map((k) => (
            <option key={k} value={k}>
              {ENTITY_LABELS[k]}
            </option>
          ))}
        </select>
        <input id="al-from" type="date" name="from" defaultValue={sp.from ?? ""} className={field} aria-label="ตั้งแต่วันที่" />
        <input id="al-to" type="date" name="to" defaultValue={sp.to ?? ""} className={field} aria-label="ถึงวันที่" />
        <input
          id="al-q"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="ค้นหา เช่น WO-2569-0323, ชื่อบ้าน, ลบ"
          className={`${field} col-span-2 sm:col-span-4`}
        />
        <button type="submit" className="rounded-(--radius) bg-[#0F766E] px-3 py-2 text-sm font-semibold text-white">
          ค้นหา
        </button>
        {filtered ? (
          <Link href="?" className="rounded-(--radius) border border-(--line) px-3 py-2 text-center text-sm">
            ล้างตัวกรอง
          </Link>
        ) : (
          <span />
        )}
      </form>

      <p className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-(--ink-soft)">
        <History className="h-4 w-4" /> {total.toLocaleString()} รายการ{pages > 1 ? ` · หน้า ${page}/${pages}` : ""}
      </p>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          {filtered ? "ไม่พบรายการตามตัวกรองนี้" : "ยังไม่มีบันทึก — เริ่มเก็บตั้งแต่อัปเดตนี้ ทุกครั้งที่มีคนสร้าง แก้ ลบ หรือเปลี่ยนสถานะในโมดูลนี้"}
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-1.5">
              <h2 className="text-xs font-semibold tracking-wide text-(--ink-soft)">{g.label}</h2>
              <Card className="divide-y divide-(--line) p-0">
                {g.items.map((r) => {
                  const who = r.userId ? (names[r.userId] ?? "ผู้ใช้") : (r.actorLabel ?? "ระบบ");
                  const href = hrefFor(r.entity, r.entityId, r.action);
                  const lines = detailLines(r.detail);
                  const action = (r.action in ACTION_LABELS ? r.action : "other") as ActivityKind;
                  return (
                    <div key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                      <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-(--ink-soft)">{timeLabel(r.createdAt)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <b className="text-sm">{who}</b>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ACTION_TONE[action]}`}>{ACTION_LABELS[action]}</span>
                          <span className="text-[11px] text-(--ink-soft)">{ENTITY_LABELS[r.entity as ActivityEntity] ?? r.entity}</span>
                        </div>
                        <p className="mt-0.5 break-words text-sm text-(--ink)">
                          {href ? (
                            <Link href={href} className="hover:underline">
                              {r.summary}
                            </Link>
                          ) : (
                            r.summary
                          )}
                        </p>
                        {lines.length > 0 && (
                          <details className="mt-1 text-xs text-(--ink-soft)">
                            <summary className="cursor-pointer select-none">รายละเอียด</summary>
                            <ul className="mt-1 flex flex-col gap-0.5 break-all pl-3">
                              {lines.map((l, i) => (
                                <li key={i}>{l}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="inline-flex items-center gap-1 rounded-(--radius) border border-(--line) px-3 py-1.5">
              <ChevronLeft className="h-4 w-4" /> ใหม่กว่า
            </Link>
          ) : null}
          <span className="text-(--ink-soft)">
            หน้า {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="inline-flex items-center gap-1 rounded-(--radius) border border-(--line) px-3 py-1.5">
              เก่ากว่า <ChevronRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      )}
    </AppScaffold>
  );
}
