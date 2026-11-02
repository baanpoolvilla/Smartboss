import { redirect } from "next/navigation";
import { canViewAll, requireOrg } from "@smartboss/auth";

import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { PmPileupCard } from "@/modules/maintenance/components/pm-pileup-card";
import { listPileups } from "@/modules/maintenance/data/pm-rounds";
import { userNameMap } from "@/modules/maintenance/data/users";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { freqLabel } from "@/modules/maintenance/lib/pm-schedule";
import { todayBangkok } from "@/modules/maintenance/lib/no-past-date";

/** PM ค้างหลายรอบ — CEO ตัดสิน (ผู้ใช้ 2/11/2569) */
export default async function PmPileupsPage() {
  const session = await requireOrg();
  if (!canViewAll(session)) redirect("/maintenance");
  const pileups = await listPileups(session.orgId);
  const names = await userNameMap(session.orgId, pileups.flatMap((p) => p.rounds.map((r) => r.assignedTo)));
  const now = Date.now();

  return (
    <AppScaffold title="PM ค้างหลายรอบ" backHref="/maintenance">
      <p className="m-0 text-sm text-(--ink-soft)">
        แผนที่มีใบ PM เลยกำหนดค้างพร้อมกันตั้งแต่ 2 รอบขึ้นไป · เลือกรอบที่ไม่ต้องทำและจะหักคะแนนหรือไม่ หรือรวบหลายรอบเป็นใบเดียวให้ช่างทำครั้งเดียว
      </p>
      {pileups.length === 0 ? (
        <p className="rounded-(--radius) border border-(--line) bg-(--bg) py-10 text-center text-sm text-(--ink-soft)">
          ไม่มี PM ที่ค้างหลายรอบ
        </p>
      ) : (
        pileups.map((p) => (
          <PmPileupCard
            key={p.pmId}
            pmId={p.pmId}
            title={`${p.title} · ${p.propertyName}`}
            subtitle={freqLabel(p.frequency)}
            minDate={todayBangkok()}
            rounds={p.rounds.map((r) => ({
              id: r.id,
              code: r.code,
              roundLabel: fmtThaiDate(r.round),
              lateDays: r.dueDate ? Math.max(1, Math.floor((now - r.dueDate.getTime()) / 86_400_000) + 1) : 0,
              docked: r.docked,
              assigneeName: r.assignedTo ? (names[r.assignedTo] ?? "-") : "ยังไม่มีผู้รับผิดชอบ",
              waived: r.overdueScore === "waived",
            }))}
          />
        ))
      )}
    </AppScaffold>
  );
}
