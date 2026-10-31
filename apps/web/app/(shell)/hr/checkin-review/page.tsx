import { requireOrg } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { HR_PERMS } from "@/modules/hr/permissions";
import { EmptyState, NoPermission, Pill, SectionCard } from "@/modules/hr/components/ui";
import { wfTry, type Employment, type Paged } from "@/modules/hr/lib/api";
import { checkinFlagLabel } from "@/modules/hr/lib/checkin-flags";
import { ReviewButtons } from "./review-row";

interface RiskAssessment {
  id: string;
  raw_time_event_id: string | null;
  employment_id: string;
  decision: string;
  risk_flags: string[];
  score: number;
  details: Record<string, unknown> | null;
  created_at: string;
}

/**
 * อ่านผลตรวจจากฐานข้อมูลตรง — ทางสำรองเมื่อ API ไม่ยอม (GET /attendance-risk-assessments ต้องยืนยันตัวตน 2 ชั้น
 * ที่ Smartboss ยังไม่มี ⇒ เดิมหน้านี้ขึ้น "ไม่มีสิทธิ์" กับทุกคน 29/10/2569) · เอาแค่เวลา/พิกัด/ธง ไม่มีรูป
 * สิทธิ์คุมด้วย HR_PERMS.employeeManage ของหน้า (HrPage) เหมือนเดิม
 */
async function assessmentsFromDb(orgId: string, decision: string, unreviewedOnly: boolean): Promise<{ items: RiskAssessment[] }> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRaw<
      { id: string; raw_time_event_id: string | null; employment_id: string; decision: string; risk_flags: string[]; score: number; details: Record<string, unknown> | null; created_at: Date }[]
    >`
      SELECT ra.id::text, ra.raw_time_event_id::text, ra.employment_id::text, ra.decision, ra.risk_flags, ra.score, ra.details, ra.created_at
      FROM workforce.mobile_risk_assessments ra
      WHERE ra.decision = ${decision} AND (${!unreviewedOnly} OR ra.reviewed_at IS NULL)
      ORDER BY ra.created_at DESC
      LIMIT 100
    `
  );
  return { items: rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })) };
}

interface MobilePunch {
  assessmentId: string;
  employmentId: string;
  intent: string;
  at: string;
  reviewOutcome: string | null;
}

/** เข้า/ออกจากมือถือห่างกันไม่เกินกี่นาที = น่าจะกดซ้ำ (เคส Nok 30/10/2569: เข้า 06:48:26 ออก 06:48:29) */
const DUPLICATE_MINUTES = 5;

/**
 * กดซ้ำติดกัน 7 วันล่าสุด — ระบบไม่ติดธงให้ (GPS ผ่าน = ACCEPTED เฉย ๆ) เลยไม่เคยขึ้นในรายการผิดปกติ
 * จับคู่ เข้า/ออก ของคนเดียวกันที่ห่างกัน ≤ DUPLICATE_MINUTES แล้วแสดงทุกครั้งที่กดในวันนั้นของคนนั้น
 * ให้ HR เลือกเองว่าอันไหนไม่นับ (เคส Nok ต้องไม่นับ 2 อัน: ออก 06:48 และเข้า 07:56 ที่กดซ้ำทีหลัง)
 */
async function duplicateTapDays(orgId: string): Promise<{ employmentId: string; day: string; punches: MobilePunch[] }[]> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRaw<{ assessment_id: string; employment_id: string; event_intent: string; captured_at: Date; review_outcome: string | null }[]>`
      SELECT ra.id::text AS assessment_id, e.employment_id::text, e.event_intent, e.captured_at, ra.review_outcome
      FROM workforce.raw_time_events e
      JOIN workforce.mobile_risk_assessments ra ON ra.raw_time_event_id = e.id
      WHERE e.source_type = 'MOBILE_APP'
        AND e.employment_id IS NOT NULL
        AND e.event_intent IN ('CLOCK_IN', 'CLOCK_OUT', 'AUTO')
        AND e.captured_at >= now() - interval '7 days'
      ORDER BY e.employment_id, e.captured_at
    `
  );
  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
  const groups = new Map<string, MobilePunch[]>();
  for (const r of rows) {
    const key = `${r.employment_id}|${dayOf(new Date(r.captured_at))}`;
    const list = groups.get(key) ?? [];
    list.push({ assessmentId: r.assessment_id, employmentId: r.employment_id, intent: r.event_intent, at: new Date(r.captured_at).toISOString(), reviewOutcome: r.review_outcome });
    groups.set(key, list);
  }
  const out: { employmentId: string; day: string; punches: MobilePunch[] }[] = [];
  for (const [key, punches] of groups) {
    // นับคู่จากทุกครั้ง (รวมที่ไม่นับไปแล้ว) — กล่องค้างจนจัดการครบทุกครั้งของวันนั้น เพราะบางวันต้องไม่นับมากกว่า 1 อัน
    // (Nok: ไม่นับออก 06:48 แล้ว ยังต้องไม่นับเข้า 07:56 ที่กดซ้ำทีหลัง) · อันที่เก็บไว้ กด "ปกติ" = ปิดเรื่อง
    const hasPair = punches.some((p, i) => i > 0 && new Date(p.at).getTime() - new Date(punches[i - 1]!.at).getTime() <= DUPLICATE_MINUTES * 60_000);
    if (!hasPair || punches.every((p) => p.reviewOutcome !== null)) continue;
    const [employmentId, day] = key.split("|") as [string, string];
    out.push({ employmentId, day, punches });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

const INTENT_TH: Record<string, string> = { CLOCK_IN: "เข้างาน", CLOCK_OUT: "ออกงาน", AUTO: "สแกน" };

function hms(iso: string): string {
  return new Date(iso).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "ลงเวลาผิดปกติ" — รายการลงเวลาจากมือถือที่ GPS ผ่านแต่มีข้อสังเกต (เช่น กดซ้ำติดกัน,
 * ตำแหน่งเปลี่ยนเร็วผิดปกติจากครั้งก่อน) **นับเวลาไปแล้ว** หน้านี้มีไว้ให้ HR เห็นแล้วไปถามเอง
 *
 * เจ้าของงานตัดสิน 2026-10-07: ไม่มีคิวรออนุมัติ — GPS ไม่ตรง = ลงไม่ได้ตั้งแต่หน้าแอป
 * (apps/web/app/api/m/checkin gpsGate) ผ่านแล้ว = นับเลย · รวมจำนวนครั้งต่อคนไว้บนสุด
 * เพราะสิ่งที่ควรถามคือแพทเทิร์น ไม่ใช่ครั้งเดียว
 *
 * ส่วน "ค้างรออนุมัติ" มีไว้เก็บตกรายการจากนโยบายเก่าที่ยังตั้ง "ส่งให้ HR ตรวจ" อยู่ —
 * รายการพวกนั้นยังไม่นับเวลาจนกว่าจะกด (นโยบายที่สร้างใหม่ไม่มีแบบนี้แล้ว)
 */
export default async function CheckinReviewPage() {
  return (
    <HrPage
      title="ลงเวลาผิดปกติ"
      permission={HR_PERMS.employeeManage}
      width="max-w-none"
      load={async () => {
        const { orgId } = await requireOrg();
        const [warnedApi, openApi, pendingApi, employments, dupDays] = await Promise.all([
          // ทั้งหมด (รวมที่จัดการแล้ว) — ไว้นับ "ใครเจอบ่อย"
          wfTry<{ items: RiskAssessment[] }>("/attendance-risk-assessments?decision=ACCEPTED_WITH_WARNING&limit=100"),
          // ที่ยังไม่ได้จัดการ — ไว้ไล่ทีละรายการ (กด "ปกติ" / "ไม่นับ" แล้วหายจากรายการ)
          wfTry<{ items: RiskAssessment[] }>(
            "/attendance-risk-assessments?unreviewed_only=true&decision=ACCEPTED_WITH_WARNING&limit=100",
          ),
          wfTry<{ items: RiskAssessment[] }>(
            "/attendance-risk-assessments?unreviewed_only=true&decision=PENDING_REVIEW&limit=100",
          ),
          wfTry<Paged<Employment>>("/employments"),
          duplicateTapDays(orgId).catch((error: unknown) => {
            console.error("[checkin-review] duplicate taps failed", error);
            return [];
          }),
        ]);
        // API ปฏิเสธ (ต้องยืนยันตัวตน 2 ชั้น) → อ่านจากฐานข้อมูลตรงแทน · API ใช้ได้ = ทำงานแบบเดิม
        const fallback = warnedApi === null && pendingApi === null;
        const [warned, open, pending] = fallback
          ? await Promise.all([
              assessmentsFromDb(orgId, "ACCEPTED_WITH_WARNING", false),
              assessmentsFromDb(orgId, "ACCEPTED_WITH_WARNING", true),
              assessmentsFromDb(orgId, "PENDING_REVIEW", true),
            ]).catch((error: unknown) => {
              console.error("[checkin-review] db fallback failed", error);
              return [null, null, null] as const;
            })
          : [warnedApi, openApi, pendingApi];
        if (warned === null && pending === null) return <NoPermission what="รายการลงเวลาผิดปกติ" />;

        const nameOf = new Map((employments?.items ?? []).map((e) => [e.id, `${e.full_name} · ${e.employee_code}`]));
        const allWarn = (warned?.items ?? []).filter((a) => a.raw_time_event_id !== null);
        const warnItems = (open?.items ?? []).filter((a) => a.raw_time_event_id !== null);
        const pendingItems = (pending?.items ?? []).filter((a) => a.raw_time_event_id !== null);

        // นับรายคน — ใครเจอบ่อยควรถามก่อน
        const perPerson = new Map<string, number>();
        for (const a of allWarn) perPerson.set(a.employment_id, (perPerson.get(a.employment_id) ?? 0) + 1);
        const ranking = [...perPerson.entries()].sort((a, b) => b[1] - a[1]);

        const row = (a: RiskAssessment, mode: "counted" | "pending") => {
          const d = a.details ?? {};
          const distance = typeof d["distance_from_site_m"] === "number" ? Math.round(d["distance_from_site_m"]) : null;
          const accuracy = typeof d["accuracy_m"] === "number" ? Math.round(d["accuracy_m"]) : null;
          return (
            <div
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-(--radius) border border-(--line) bg-(--bg) p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-(--ink)">{nameOf.get(a.employment_id) ?? "พนักงาน"}</p>
                <p className="text-xs text-(--ink-soft)">
                  ลงเวลา {when(a.created_at)}
                  {distance !== null && ` · ห่างจุดที่ตั้ง ${distance} ม.`}
                  {accuracy !== null && ` · GPS คลาด ±${accuracy} ม.`}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {a.risk_flags.map((f) => (
                    <Pill key={f} tone="var(--tone-warn)">
                      {checkinFlagLabel(f)}
                    </Pill>
                  ))}
                </div>
              </div>
              <ReviewButtons id={a.id} employmentId={a.employment_id} at={a.created_at} mode={mode} />
            </div>
          );
        };

        return (
          <div className="flex flex-col gap-4">
            {dupDays.length > 0 && (
              <SectionCard
                title={`กดซ้ำติดกัน ${dupDays.length} วัน (7 วันล่าสุด)`}
                description={`เข้า/ออกจากมือถือห่างกันไม่ถึง ${DUPLICATE_MINUTES} นาที — มักเป็นคนกดรัวเพราะคิดว่าไม่ติด · แสดงทุกครั้งที่กดในวันนั้น กด "ไม่นับรายการนี้" ที่อันที่กดซ้ำ ให้เหลือเวลาจริง (ส่วนใหญ่เก็บเข้างานครั้งแรกไว้) · อันที่เก็บไว้กด "ปกติ" แล้ววันนั้นจะหายจากรายการ`}
              >
                <div className="flex flex-col gap-3">
                  {dupDays.map((g) => (
                    <div key={`${g.employmentId}-${g.day}`} className="flex flex-col gap-2 rounded-(--radius) border border-(--line) bg-(--bg) p-3">
                      <p className="text-sm font-medium text-(--ink)">
                        {nameOf.get(g.employmentId) ?? "พนักงาน"} · {new Date(`${g.day}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
                      </p>
                      {g.punches.map((p) => (
                        <div
                          key={p.assessmentId}
                          className={`flex flex-wrap items-center justify-between gap-2 border-t border-(--line) pt-2 ${p.reviewOutcome === "REJECTED" ? "opacity-50" : ""}`}
                        >
                          <span className="text-sm tabular-nums">
                            {hms(p.at)} · {INTENT_TH[p.intent] ?? p.intent}
                            {p.reviewOutcome === "REJECTED" && <span className="ml-2 text-xs text-(--danger)">ไม่นับแล้ว</span>}
                            {p.reviewOutcome === "APPROVED" && <span className="ml-2 text-xs text-(--ink-soft)">ตรวจแล้ว ปกติ</span>}
                          </span>
                          {p.reviewOutcome === null && <ReviewButtons id={p.assessmentId} employmentId={p.employmentId} at={p.at} mode="counted" />}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="ใครเจอบ่อย"
              description="นับเวลาให้ไปแล้ว — ถ้าคนไหนเจอบ่อย ลองไปถามดู (นับจาก 100 รายการล่าสุด รวมที่จัดการแล้ว)"
            >
              {ranking.length === 0 ? (
                <EmptyState>ไม่มีการลงเวลาที่ผิดปกติ</EmptyState>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ranking.map(([employmentId, count]) => (
                    <Pill key={employmentId} tone={count >= 3 ? "var(--danger)" : "var(--tone-warn)"}>
                      {nameOf.get(employmentId) ?? "พนักงาน"} · {count} ครั้ง
                    </Pill>
                  ))}
                </div>
              )}
            </SectionCard>

            {warnItems.length > 0 && (
              <SectionCard
                title={`ยังไม่ได้จัดการ ${warnItems.length} รายการ`}
                description="นับเวลาไปแล้ว · ถามแล้วปกติ กด 'ปกติ' · ผิดจริง (เช่น ฝากกดแทน) กด 'ไม่นับรายการนี้' — กระทบคะแนนผลงาน และพนักงานได้แจ้งเตือนพร้อมเหตุผล"
              >
                <div className="flex flex-col gap-2">{warnItems.map((a) => row(a, "counted"))}</div>
              </SectionCard>
            )}

            {pendingItems.length > 0 && (
              <SectionCard
                title={`ค้างรออนุมัติ ${pendingItems.length} รายการ`}
                description="มาจากนโยบายลงเวลาแบบเก่าที่ยังตั้ง 'ส่งให้ HR ตรวจ' — ยังไม่นับเวลาจนกว่าจะกด · ย้ายคนไปกลุ่มนโยบายใหม่แล้วจะไม่เกิดอีก"
              >
                <div className="flex flex-col gap-2">{pendingItems.map((a) => row(a, "pending"))}</div>
              </SectionCard>
            )}
          </div>
        );
      }}
    />
  );
}
