import Link from "next/link";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Employment,
  type Paged,
  type RawTimeEvent,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Pill,
  SectionCard,
  StatCard,
  Td,
} from "@/modules/hr/components/ui";
import { AutoRefresh } from "./auto-refresh";

const PRESETS = [
  { days: 0, label: "วันนี้" },
  { days: 6, label: "7 วัน" },
  { days: 29, label: "30 วัน" },
];

function rangeForDays(days: number): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(now.getTime() - days * 86_400_000)), to: iso(now) };
}

/** 2026-08-27T08:02:11Z → "08:02:11" ตามเวลาไทย */
function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
}

const SOURCE_LABEL: Record<string, string> = {
  FINGERPRINT_DEVICE: "สแกนนิ้ว",
  LEGACY_UNTRUSTED: "ระบบเดิม",
  MANUAL: "บันทึกมือ",
  KIOSK: "Kiosk",
};

export default async function TimeEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; emp?: string }>;
}) {
  const sp = await searchParams;
  const days = PRESETS.some((p) => String(p.days) === sp.days) ? Number(sp.days) : 0;

  return (
    <HrPage
      title="การลงเวลา"
      permission={HR_PERMS.employeeView}
      load={async () => {
        const { from, to } = rangeForDays(days);
        const empQuery = sp.emp ? `&employment_id=${sp.emp}` : "";

        const [events, employments] = await Promise.all([
          wfFetch<{ items: RawTimeEvent[] }>(
            `/raw-time-events?from=${from}&to=${to}&limit=300${empQuery}`,
          ),
          wfTry<Paged<Employment>>("/employments"),
        ]);

        const rows = events.items;
        const unresolved = rows.filter((r) => !r.slot_resolved).length;
        const people = new Set(
          rows.filter((r) => r.employment_id !== null).map((r) => r.employment_id),
        ).size;

        return (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="การสแกนทั้งหมด" value={String(rows.length)} />
              <StatCard label="พนักงานที่สแกน" value={String(people)} hint="คน" />
              <StatCard
                label="ไม่รู้ว่าเป็นใคร"
                value={String(unresolved)}
                tone={unresolved > 0 ? "var(--danger)" : "var(--ink)"}
                hint={unresolved > 0 ? "ต้องผูกลายนิ้วมือก่อน" : "ผูกครบทุกครั้ง"}
              />
            </div>

            <SectionCard
              title="รายการสแกน"
              description="ข้อมูลดิบจากเครื่อง ยังไม่ผ่านการคำนวณ — ใช้ตรวจว่าเครื่องส่งข้อมูลถึงเซิร์ฟเวอร์จริงไหม"
              action={<AutoRefresh />}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-(--ink-soft)">ช่วงเวลา:</span>
                {PRESETS.map((preset) => (
                  <Link
                    key={preset.days}
                    href={`/hr/time-events?days=${preset.days}${sp.emp ? `&emp=${sp.emp}` : ""}`}
                    className="rounded-full border px-3 py-1 text-xs transition-colors"
                    style={
                      preset.days === days
                        ? {
                            color: "var(--app-strong)",
                            borderColor: "var(--app)",
                            backgroundColor: "var(--app-soft)",
                          }
                        : { color: "var(--ink-soft)", borderColor: "var(--line)" }
                    }
                  >
                    {preset.label}
                  </Link>
                ))}

                {employments !== null && (
                  <form method="GET" className="ml-auto flex items-center gap-2">
                    <input type="hidden" name="days" value={days} />
                    <select
                      name="emp"
                      defaultValue={sp.emp ?? ""}
                      className="h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-xs"
                    >
                      <option value="">ทุกคน</option>
                      {employments.items.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.employee_code} · {e.full_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-full border border-(--line) px-3 py-1 text-xs text-(--ink-soft) transition-colors hover:bg-(--bg-soft)"
                    >
                      กรอง
                    </button>
                  </form>
                )}
              </div>

              {rows.length === 0 ? (
                <EmptyState>
                  ยังไม่มีการสแกนในช่วงนี้ — ถ้าเพิ่งให้คนแตะนิ้วแล้วยังไม่ขึ้น
                  ตรวจว่าเครื่องต่อเน็ตอยู่และจอขึ้นชื่อคนสแกน
                </EmptyState>
              ) : (
                <DataTable
                  head={["เวลา", "พนักงาน", "เครื่อง", "ประเภท", "Slot", "คะแนน"]}
                >
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-(--bg-soft)">
                      <Td>
                        <span className="font-mono text-sm font-medium">
                          {clockOf(row.captured_at)}
                        </span>
                        <span className="ml-2 text-xs text-(--ink-soft)">
                          {dateOf(row.captured_at)}
                        </span>
                      </Td>
                      <Td>
                        {row.slot_resolved && row.display_name !== null ? (
                          <>
                            <span className="font-medium">{row.display_name}</span>
                            {row.employee_code && (
                              <span className="ml-2 font-mono text-xs text-(--ink-soft)">
                                {row.employee_code}
                              </span>
                            )}
                          </>
                        ) : (
                          <Pill tone="var(--danger)">ไม่รู้ว่าเป็นใคร</Pill>
                        )}
                      </Td>
                      <Td className="text-(--ink-soft)">
                        {row.device_code ?? "—"}
                        {row.device_name && (
                          <span className="ml-1 text-xs">({row.device_name})</span>
                        )}
                      </Td>
                      <Td className="text-(--ink-soft)">
                        {SOURCE_LABEL[row.source_type] ?? row.source_type}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {row.template_slot ?? "—"}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {row.match_score ?? "—"}
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              )}

              {unresolved > 0 && (
                <p className="mt-3 text-xs text-(--ink-soft)">
                  มี {unresolved} ครั้งที่ระบบไม่รู้ว่าเป็นใคร — slot นั้นยังไม่ถูกผูกกับพนักงาน
                  การสแกนถูกเก็บไว้เป็นหลักฐานแต่<strong>ไม่กลายเป็นเวลาทำงานของใคร</strong>{" "}
                  ผูกได้ที่หน้า{" "}
                  <Link href="/hr/devices" className="text-(--app-strong) hover:underline">
                    เครื่องสแกน
                  </Link>
                </p>
              )}

              <p className="mt-2 text-xs text-(--ink-soft)">
                หน้านี้คือข้อมูลที่เครื่องส่งมา ยังไม่ใช่ผลลงเวลา — สาย/ขาด/OT ต้องสั่งคำนวณที่หน้า{" "}
                <Link href="/hr/attendance" className="text-(--app-strong) hover:underline">
                  ผลลงเวลา
                </Link>
              </p>
            </SectionCard>
          </div>
        );
      }}
    />
  );
}
