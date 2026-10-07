import { HrPage } from "@/modules/hr/components/hr-page";
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
      width="max-w-3xl"
      load={async () => {
        const [warned, open, pending, employments] = await Promise.all([
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
        ]);
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
