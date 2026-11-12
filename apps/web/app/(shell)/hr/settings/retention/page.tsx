import Link from "next/link";
import { requireOrg } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
import { HR_PERMS } from "@/modules/hr/permissions";
import { DataTable, EmptyState, SectionCard, StatCard, Td } from "@/modules/hr/components/ui";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { bangkokDay } from "@/lib/offboarding";

/**
 * ข้อมูลครบกำหนดเก็บ (PDPA) — 12/11/2569
 *
 * ระยะเวลาที่ตกลงไว้ (11/11): แฟ้มพนักงาน + เงินเดือน 10 ปีหลังออก · ลงเวลา/วันลา 2 ปี ·
 * ลายนิ้วมือลบตอนออก · ระบบไม่ลบเอง — HR ดูจากหน้านี้แล้วตัดสินใจ
 *
 * หน้านี้ "ดูอย่างเดียว" — ยังไม่มีปุ่มลบ เพราะตารางลงเวลา/เงินเดือนหลายตารางของ workforce
 * ล็อกห้ามแก้/ลบไว้ด้วย trigger (raw_time_events, leave_balance_ledger, payroll_*…)
 * วิธีลบ (ลบทิ้งทั้งแถว หรือปิดชื่อให้เหลือแต่ตัวเลข) ยังรอตัดสินใจ
 */

const RULES = [
  { what: "แฟ้มพนักงาน + เงินเดือน + สลิป", keep: "10 ปี นับจากวันที่ออก", note: "ตามอายุความภาษีและแรงงาน" },
  { what: "ลงเวลา และ วันลา", keep: "2 ปี นับจากวันที่ของรายการ", note: "คนที่ยังทำงานอยู่ก็นับ" },
  { what: "ลายนิ้วมือ", keep: "ลบทันทีเมื่อออก", note: "ระบบลบให้ตอนกดแจ้งพ้นสภาพ — หน้านี้จับรายการที่หลุด" },
];

const addYears = (ymd: string, years: number) => `${Number(ymd.slice(0, 4)) + years}${ymd.slice(4)}`;
const thaiDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

interface LeaverRow {
  id: string;
  name: string;
  code: string | null;
  terminated_on: string;
  fingers: number;
}

export default async function HrRetentionPage() {
  return (
    <HrPage
      title="ข้อมูลครบกำหนดเก็บ"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const { orgId } = await requireOrg();
        const today = bangkokDay();
        const twoYearsAgo = addYears(today, -2);

        const data = await withWorkforceTenant(orgId, async (tx) => {
          const leavers = await tx.$queryRawUnsafe<LeaverRow[]>(
            `SELECT e.id::text AS id, e.employee_code AS code, e.terminated_on::text AS terminated_on,
                    trim(coalesce(nullif(p.preferred_name, ''), p.first_name || ' ' || coalesce(p.last_name, ''))) AS name,
                    (SELECT count(*)::int FROM workforce.biometric_enrollments b
                      WHERE b.employment_id = e.id AND b.status IN ('PENDING', 'ACTIVE') AND b.deleted_at IS NULL) AS fingers
               FROM workforce.employments e JOIN workforce.people p ON p.id = e.person_id
              WHERE e.terminated_on IS NOT NULL
              ORDER BY e.terminated_on`,
          );
          const [att] = await tx.$queryRawUnsafe<{ oldest: string | null; due: number }[]>(
            `SELECT min(work_date)::text AS oldest, count(*) FILTER (WHERE work_date < $1::date)::int AS due
               FROM workforce.attendance_results`,
            twoYearsAgo,
          );
          const [leave] = await tx.$queryRawUnsafe<{ oldest: string | null; due: number }[]>(
            `SELECT min(ends_on)::text AS oldest, count(*) FILTER (WHERE ends_on < $1::date)::int AS due
               FROM workforce.leave_requests`,
            twoYearsAgo,
          );
          return { leavers, att: att!, leave: leave! };
        });

        const leftFingers = data.leavers.filter((l) => l.fingers > 0 && l.terminated_on < today);
        const fileDue = data.leavers.filter((l) => addYears(l.terminated_on, 10) <= today);
        const timeDue = data.att.due + data.leave.due;
        const oldestTime = [data.att.oldest, data.leave.oldest].filter((d): d is string => !!d).sort()[0] ?? null;

        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <SettingsSubnav active="/hr/settings/retention" />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <p className="text-sm text-(--ink-soft)">
                รายการข้อมูลที่เก็บครบกำหนดตาม PDPA แล้ว ระบบ<b>ไม่ลบเอง</b> — HR ดูจากหน้านี้แล้วตัดสินใจ
                (ตอนนี้หน้านี้ดูได้อย่างเดียว ยังไม่มีปุ่มลบ)
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard
                  label="ลายนิ้วมือคนที่ออกแล้วยังค้าง"
                  value={leftFingers.length}
                  hint={leftFingers.length ? "ควรลบออกจากเครื่องสแกน" : "ไม่มีค้าง"}
                  tone={leftFingers.length ? "var(--danger, #c0392b)" : "var(--ink)"}
                />
                <StatCard
                  label="ลงเวลา/วันลา เกิน 2 ปี"
                  value={timeDue.toLocaleString("th-TH")}
                  hint={
                    timeDue
                      ? "รายการ"
                      : oldestTime
                        ? `ครบครั้งแรก ${thaiDate(addYears(oldestTime, 2))}`
                        : "ยังไม่มีข้อมูล"
                  }
                />
                <StatCard
                  label="แฟ้มคนที่ออกเกิน 10 ปี"
                  value={fileDue.length}
                  hint={
                    fileDue.length
                      ? "คน"
                      : data.leavers[0]
                        ? `ครบครั้งแรก ${thaiDate(addYears(data.leavers[0].terminated_on, 10))}`
                        : "ยังไม่มีคนออก"
                  }
                />
              </div>

              <SectionCard title="ระยะเวลาเก็บที่ใช้อยู่">
                <div className="flex flex-col gap-2">
                  {RULES.map((r) => (
                    <div key={r.what} className="flex flex-col gap-0.5 border-b border-(--line) pb-2 last:border-0 last:pb-0 sm:flex-row sm:gap-3">
                      <span className="text-sm font-medium text-(--ink) sm:w-56 sm:shrink-0">{r.what}</span>
                      <span className="text-sm text-(--ink) sm:w-48 sm:shrink-0">{r.keep}</span>
                      <span className="text-xs text-(--ink-soft)">{r.note}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {leftFingers.length > 0 && (
                <SectionCard
                  title="ลายนิ้วมือที่ยังไม่ถูกลบ"
                  description="คนเหล่านี้ออกไปแล้วแต่ลายนิ้วมือยังอยู่ในเครื่องสแกน — เปิดหน้าพนักงานเพื่อลบ"
                >
                  <DataTable head={["พนักงาน", "วันที่ออก", "ลายนิ้วมือ"]}>
                    {leftFingers.map((l) => (
                      <tr key={l.id}>
                        <Td>
                          <Link prefetch={false} href={`/hr/employees/${l.id}`} className="underline">
                            {l.name || l.code || "—"}
                          </Link>
                        </Td>
                        <Td>{thaiDate(l.terminated_on)}</Td>
                        <Td numeric>{l.fingers}</Td>
                      </tr>
                    ))}
                  </DataTable>
                </SectionCard>
              )}

              <SectionCard
                title="คนที่ออกแล้ว — กำหนดครบ 10 ปี"
                description="แฟ้มพนักงาน เงินเดือน และสลิปของคนเหล่านี้เก็บถึงวันที่ในคอลัมน์ขวา"
              >
                {data.leavers.length === 0 ? (
                  <EmptyState>ยังไม่มีพนักงานที่ออก</EmptyState>
                ) : (
                  <DataTable head={["พนักงาน", "วันที่ออก", "เก็บถึง", "สถานะ"]}>
                    {data.leavers.map((l) => {
                      const due = addYears(l.terminated_on, 10);
                      return (
                        <tr key={l.id}>
                          <Td>{l.name || l.code || "—"}</Td>
                          <Td>{thaiDate(l.terminated_on)}</Td>
                          <Td>{thaiDate(due)}</Td>
                          <Td>{due <= today ? <b>ครบกำหนดแล้ว</b> : <span className="text-(--ink-soft)">ยังไม่ครบ</span>}</Td>
                        </tr>
                      );
                    })}
                  </DataTable>
                )}
              </SectionCard>
            </div>
          </div>
        );
      }}
    />
  );
}
