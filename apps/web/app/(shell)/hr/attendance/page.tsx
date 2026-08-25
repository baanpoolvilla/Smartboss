import Link from "next/link";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfTry,
  type AttendanceSummary,
  type Employment,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  NoPermission,
  StatCard,
  Td,
} from "@/modules/hr/components/ui";
import { formatMinutes } from "@/modules/hr/lib/labels";
import { RecalculateForm } from "./recalculate-form";

function rangeForDays(days: number): { from: string; to: string } {
  const today = new Date();
  const past = new Date(today.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(past), to: iso(today) };
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;

  return (
    <HrPage
      title="ผลลงเวลา"
      permission={HR_PERMS.employeeView}
      load={async () => {
        const preset = rangeForDays(days);
        const from = sp.from ?? preset.from;
        const to = sp.to ?? preset.to;

        const [summary, employments] = await Promise.all([
          wfTry<AttendanceSummary>(`/attendance-summary?from=${from}&to=${to}`),
          wfTry<Paged<Employment>>("/employments"),
        ]);

        if (summary === null) return <NoPermission what="ผลลงเวลาของทั้งบริษัท" />;

        const nameOf = (employmentId: string) =>
          (employments?.items ?? []).find((e) => e.id === employmentId)?.full_name ??
          employmentId.slice(0, 8);

        const t = summary.totals;

        const activePeople = (employments?.items ?? [])
          .filter((e) => e.terminated_on === null)
          .map((e) => ({ id: e.id, label: `${e.employee_code} · ${e.full_name}` }));

        return (
          <>
            <RecalculateForm people={activePeople} from={from} to={to} />

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-(--ink-soft)">ช่วงเวลา:</span>
              {[7, 30, 90].map((d) => (
                <Link
                  key={d}
                  href={`/hr/attendance?days=${d}`}
                  className="rounded-full border px-3 py-1 text-xs transition-colors"
                  style={
                    d === days && !sp.from
                      ? {
                          color: "var(--app-strong)",
                          borderColor: "var(--app)",
                          backgroundColor: "var(--app-soft)",
                        }
                      : { color: "var(--ink-soft)", borderColor: "var(--line)" }
                  }
                >
                  {d} วัน
                </Link>
              ))}
              <span className="ml-1 text-xs text-(--ink-soft)">
                {summary.from} → {summary.to}
              </span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="พนักงาน" value={t.employees} tone="var(--app)" />
              <StatCard
                label="ชั่วโมงทำงาน"
                value={formatMinutes(t.worked_minutes)}
                hint={`${t.worked_days} วัน`}
                tone="var(--tone-ok)"
              />
              <StatCard
                label="มาสาย"
                value={`${t.late_days} วัน`}
                hint={formatMinutes(t.late_minutes)}
                tone="var(--tone-warn)"
              />
              <StatCard
                label="ขาดงาน"
                value={`${t.absent_days} วัน`}
                hint={formatMinutes(t.absence_minutes)}
                tone="var(--tone-danger)"
              />
              <StatCard
                label="ล่วงเวลา"
                value={formatMinutes(t.ot_minutes)}
                tone="var(--tone-info)"
              />
            </div>

            {summary.employees.length === 0 ? (
              <EmptyState>
                ไม่มีผลลงเวลาในช่วงนี้ — ถ้าเพิ่งติดตั้งเครื่องสแกน
                ต้องผูกลายนิ้วมือกับพนักงานก่อน
              </EmptyState>
            ) : (
              <DataTable
                head={[
                  "พนักงาน",
                  "วันทำงาน",
                  "ชั่วโมงทำงาน",
                  "มาสาย",
                  "ออกก่อน",
                  "ขาด",
                  "OT",
                ]}
              >
                {summary.employees.map((row) => (
                  <tr key={row.employment_id} className="hover:bg-(--bg-soft)">
                    <Td>
                      <Link
                        href={`/hr/employees/${row.employment_id}`}
                        className="font-medium hover:underline"
                      >
                        {nameOf(row.employment_id)}
                      </Link>
                    </Td>
                    <Td align="right">
                      {row.worked_days}/{row.days}
                    </Td>
                    <Td align="right">{formatMinutes(row.worked_minutes)}</Td>
                    <Td align="right">
                      {row.late_minutes > 0 ? (
                        <span style={{ color: "var(--tone-warn)" }}>
                          {formatMinutes(row.late_minutes)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td align="right">
                      {row.early_out_minutes > 0
                        ? formatMinutes(row.early_out_minutes)
                        : "—"}
                    </Td>
                    <Td align="right">
                      {row.absent_days > 0 ? (
                        <span style={{ color: "var(--tone-danger)" }}>
                          {row.absent_days} วัน
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td align="right">{formatMinutes(row.ot_minutes)}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </>
        );
      }}
    />
  );
}
