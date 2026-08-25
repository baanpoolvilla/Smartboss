import Link from "next/link";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfTry,
  type AttendanceException,
  type AttendanceSummary,
  type Employment,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  NoPermission,
  Pill,
  SectionCard,
  StatCard,
  Td,
} from "@/modules/hr/components/ui";
import { formatMinutes } from "@/modules/hr/lib/labels";
import { RecalculateForm } from "./recalculate-form";

/**
 * เครื่องคำนวณบอกสาเหตุไว้ครบอยู่แล้ว แต่ไม่เคยมีหน้าจอไหนแสดง —
 * ผู้ใช้จึงเห็นแค่ 0 ทุกช่องโดยไม่มีทางรู้ว่าต้องไปทำอะไรต่อ
 */
const EXCEPTION_INFO: Record<string, { label: string; fix: string }> = {
  NO_SHIFT_ASSIGNED: {
    label: "ยังไม่ได้ผูกกะ",
    fix: "สแกนแล้วแต่ระบบไม่รู้ว่าวันนั้นควรเข้ากี่โมง — ผูกกะที่หน้า “กะทำงาน” แล้วสั่งคำนวณใหม่",
  },
  POLICY_NOT_FOUND: {
    label: "ยังไม่มีนโยบายการทำงาน",
    fix: "สร้างนโยบายที่หน้า “กะทำงาน” แล้วผูกเข้ากับกะ",
  },
  MISSING_IN: { label: "ไม่มีเวลาเข้า", fix: "ลืมสแกนตอนเข้า — แก้ที่คำขอปรับผลลงเวลา" },
  MISSING_OUT: { label: "ไม่มีเวลาออก", fix: "ลืมสแกนตอนออก — แก้ที่คำขอปรับผลลงเวลา" },
  DUPLICATE_PUNCH: { label: "สแกนซ้ำ", fix: "ระบบตัดให้แล้ว ไม่ต้องทำอะไร" },
  EXCESSIVE_WORK_DURATION: {
    label: "ทำงานยาวผิดปกติ",
    fix: "อาจลืมสแกนออกแล้วมาสแกนวันถัดไป — ตรวจก่อนอนุมัติ",
  },
  UNAPPROVED_OT: { label: "OT ยังไม่ได้อนุมัติ", fix: "รออนุมัติก่อนจึงจะนับเป็น OT" },
  BREAK_VIOLATION: { label: "พักไม่ตรงตามกำหนด", fix: "ตรวจช่วงพักของกะนั้น" },
  INACTIVE_EMPLOYMENT: {
    label: "ยังไม่เริ่มงาน / พ้นสภาพแล้ว",
    fix: "วันที่คำนวณอยู่นอกช่วงสัญญาจ้าง — ตรวจวันเริ่มงานที่หน้าพนักงาน",
  },
  PENDING_EVIDENCE_REVIEW: { label: "รอตรวจหลักฐาน", fix: "รอผู้ดูแลตรวจ" },
};

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

        const [summary, employments, exceptions] = await Promise.all([
          wfTry<AttendanceSummary>(`/attendance-summary?from=${from}&to=${to}`),
          wfTry<Paged<Employment>>("/employments"),
          wfTry<{ items: AttendanceException[] }>(
            `/attendance-exceptions?from=${from}&to=${to}&status=OPEN`,
          ),
        ]);

        if (summary === null) return <NoPermission what="ผลลงเวลาของทั้งบริษัท" />;

        const nameOf = (employmentId: string) =>
          (employments?.items ?? []).find((e) => e.id === employmentId)?.full_name ??
          employmentId.slice(0, 8);

        const t = summary.totals;

        const activePeople = (employments?.items ?? [])
          .filter((e) => e.terminated_on === null)
          .map((e) => ({ id: e.id, label: `${e.employee_code} · ${e.full_name}` }));

        // จัดกลุ่มตามสาเหตุ — 31 วัน x 2 คน ที่ติดเรื่องเดียวกันคือปัญหาเดียว
        // ไม่ใช่ 62 ปัญหา แสดงเรียงรายวันจะกลบสาระจนหาไม่เจอว่าต้องแก้อะไร
        const openExceptions = exceptions?.items ?? [];
        const grouped = new Map<
          string,
          { code: string; count: number; blocking: boolean; people: Set<string> }
        >();
        for (const ex of openExceptions) {
          const bucket = grouped.get(ex.code) ?? {
            code: ex.code,
            count: 0,
            blocking: false,
            people: new Set<string>(),
          };
          bucket.count += 1;
          bucket.blocking = bucket.blocking || ex.blocking;
          bucket.people.add(ex.employment_id);
          grouped.set(ex.code, bucket);
        }
        const issues = [...grouped.values()].sort(
          (a, b) => Number(b.blocking) - Number(a.blocking) || b.count - a.count,
        );

        return (
          <>
            <RecalculateForm people={activePeople} from={from} to={to} />

            {issues.length > 0 && (
              <SectionCard
                title="สิ่งที่ทำให้ผลลงเวลายังไม่ออก"
                description="ระบบคำนวณแล้วแต่ติดเรื่องพวกนี้ — แก้แล้วสั่งคำนวณใหม่อีกครั้ง"
                className="mb-4"
              >
                <DataTable head={["สาเหตุ", "จำนวนวัน", "พนักงาน", "ต้องทำอะไร"]}>
                  {issues.map((issue) => {
                    const info = EXCEPTION_INFO[issue.code];
                    return (
                      <tr key={issue.code} className="hover:bg-(--bg-soft)">
                        <Td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">
                              {info?.label ?? issue.code}
                            </span>
                            {issue.blocking && (
                              <Pill tone="var(--danger)">คำนวณต่อไม่ได้</Pill>
                            )}
                          </div>
                          {info === undefined && (
                            <span className="font-mono text-xs text-(--ink-soft)">
                              {issue.code}
                            </span>
                          )}
                        </Td>
                        <Td align="right">{issue.count}</Td>
                        <Td align="right">{issue.people.size}</Td>
                        <Td className="text-(--ink-soft)">{info?.fix ?? "—"}</Td>
                      </tr>
                    );
                  })}
                </DataTable>
              </SectionCard>
            )}

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
