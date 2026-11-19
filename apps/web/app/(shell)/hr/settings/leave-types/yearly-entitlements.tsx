"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { fmtDays } from "@/modules/hr/lib/leave-type-choice";
import { setYearlyEntitlementsAction } from "../../actions";

import { useCeoTitle } from "@/lib/ceo-title-client";
export interface YearlyRow {
  employmentId: string;
  name: string;
  code: string;
  entitled: number;
  used: number;
  pending: number;
  available: number;
}

/**
 * ตารางสิทธิ์ลารายปีของแต่ละคน — HR กรอกจำนวนวันเอง ปีปฏิทิน ม.ค.–ธ.ค. หมดปีแล้วทิ้ง
 * ส่วนนี้แสดงเฉพาะฝ่ายบุคคลและ CEO (yearly-entitlement-access.ts) คนอื่นไม่รู้ว่าใครได้กี่วัน
 * แก้หลายคนแล้วกด "บันทึกทั้งหมด" ทีเดียว (ผู้ใช้ 19/11/2569) — เดิมต้องกดบันทึกทีละคน
 */
export function YearlyEntitlements({
  leaveTypeId,
  leaveTypeName,
  year,
  rows,
}: {
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  rows: YearlyRow[];
}) {
  const ceo = useCeoTitle();
  const router = useRouter();
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "th"));
  const unset = rows.filter((r) => r.entitled <= 0).length;
  const yearLink = (y: number) => `/hr/settings/leave-types?year=${y}#yearly-${leaveTypeId}`;
  const saved = (r: YearlyRow) => (r.entitled > 0 ? fmtDays(r.entitled) : "");
  // เก็บเฉพาะช่องที่แก้ · ข้อผิดพลาดแยกรายคน
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isDirty = (r: YearlyRow) => drafts[r.employmentId] !== undefined && drafts[r.employmentId]!.trim() !== saved(r);
  const dirtyRows = sorted.filter(isDirty);
  const blank = dirtyRows.filter((r) => drafts[r.employmentId]!.trim() === "").length;

  // ยังไม่ได้บันทึกแล้วจะปิด/ออกจากหน้า — เตือนก่อน
  useEffect(() => {
    if (dirtyRows.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyRows.length]);

  const saveAll = () => {
    if (dirtyRows.length === 0 || blank > 0) return;
    setNotice(null);
    const items = dirtyRows.map((r) => ({ employmentId: r.employmentId, days: drafts[r.employmentId]!.trim() }));
    startTransition(async () => {
      const res = await setYearlyEntitlementsAction({ leaveTypeId, year, items });
      if (res.error) {
        setNotice(res.error);
        return;
      }
      const failed = Object.fromEntries(res.results.filter((x) => x.error).map((x) => [x.employmentId, x.error!]));
      const ok = new Set(res.results.filter((x) => !x.error).map((x) => x.employmentId));
      setErrors(failed);
      // ที่บันทึกสำเร็จ ล้างช่องแก้ (ค่าใหม่มาจากเซิร์ฟเวอร์ตอน refresh) · ที่พลาดคงค่าที่พิมพ์ไว้ให้แก้ต่อ
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !ok.has(id))));
      const failCount = Object.keys(failed).length;
      setNotice(failCount > 0 ? `บันทึกแล้ว ${ok.size} คน · ไม่สำเร็จ ${failCount} คน (ดูข้อความใต้ช่อง)` : `บันทึกแล้ว ${ok.size} คน`);
      router.refresh();
    });
  };

  return (
    <section id={`yearly-${leaveTypeId}`} data-testid="yearly-entitlements" className="rounded-(--radius) border border-(--line) bg-(--bg) p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-(--ink)">สิทธิ์{leaveTypeName}รายคน · ปี {year + 543}</h2>
          <p className="text-xs text-(--ink-soft)">
            แก้จำนวนวันได้หลายคน แล้วกด &quot;บันทึกทั้งหมด&quot; ทีเดียว · นับ ม.ค.–ธ.ค. หมดปีแล้วทิ้ง · เห็นได้เฉพาะเจ้าตัว ฝ่ายบุคคล และ {ceo}
            {unset > 0 ? ` · ยังไม่ได้กรอก ${unset} คน (คนกลุ่มนี้ลงประเภทนี้ไม่ได้)` : ""}
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          <Link href={yearLink(year - 1)} className="rounded-full border border-(--line) px-2.5 py-1 hover:bg-(--bg-soft)">‹ {year + 542}</Link>
          <Link href={yearLink(year + 1)} className="rounded-full border border-(--line) px-2.5 py-1 hover:bg-(--bg-soft)">{year + 544} ›</Link>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-(--ink-soft)">ยังไม่มีพนักงาน</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveAll();
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--line) text-left text-xs text-(--ink-soft)">
                  <th className="py-2 pr-2 font-medium">พนักงาน</th>
                  <th className="py-2 pr-2 font-medium">ได้ (วัน/ปี)</th>
                  <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">อนุมัติแล้ว</th>
                  <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">รออนุมัติ</th>
                  <th className="hidden py-2 text-right font-medium sm:table-cell">เหลือ</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <Row
                    key={`${r.employmentId}:${year}`}
                    row={r}
                    value={drafts[r.employmentId] ?? saved(r)}
                    dirty={isDirty(r)}
                    error={errors[r.employmentId]}
                    onChange={(v) => {
                      setDrafts((d) => ({ ...d, [r.employmentId]: v }));
                      setNotice(null);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {/* แถบบันทึก — ติดขอบล่างจอตอนมีช่องที่แก้ (รายชื่อยาวเลื่อนลงไปก็ยังเห็น) */}
          {(dirtyRows.length > 0 || notice) && (
            <div
              className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-end gap-2 rounded-(--radius) border border-(--line) bg-(--bg) px-3 pt-2 shadow-[0_-2px_8px_rgba(16,24,40,0.06)]"
              style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
              data-testid="yearly-save-bar"
            >
              <span className="mr-auto text-xs text-(--ink-soft)" aria-live="polite">
                {dirtyRows.length > 0
                  ? blank > 0
                    ? `แก้ไข ${dirtyRows.length} คน · มีช่องว่าง ${blank} ช่อง ใส่ตัวเลขก่อน (0 = ไม่ได้สิทธิ์)`
                    : `แก้ไขแล้ว ${dirtyRows.length} คน ยังไม่ได้บันทึก`
                  : notice}
              </span>
              {dirtyRows.length > 0 && (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setDrafts({});
                      setErrors({});
                      setNotice(null);
                    }}
                    className="h-9 rounded-md border border-(--line) px-3 text-sm font-semibold text-(--ink) disabled:opacity-50"
                  >
                    ยกเลิกที่แก้
                  </button>
                  <button type="submit" disabled={pending || blank > 0} className="h-9 rounded-md bg-(--brand-navy) px-3 text-sm font-semibold text-white disabled:opacity-50">
                    {pending ? "กำลังบันทึก…" : `บันทึกทั้งหมด (${dirtyRows.length} คน)`}
                  </button>
                </>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  );
}

function Row({
  row,
  value,
  dirty,
  error,
  onChange,
}: {
  row: YearlyRow;
  value: string;
  dirty: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <tr className="border-b border-(--line) last:border-0" data-testid={`yearly-row-${row.employmentId}`}>
      <td className="py-2 pr-2 font-medium">
        {row.name}
        {row.code && <span className="ml-1 text-xs font-normal text-(--ink-soft)">{row.code}</span>}
        {/* มือถือไม่มีที่พอสำหรับ 3 ช่องตัวเลข — รวมไว้ใต้ชื่อ */}
        <span className={`block text-xs font-normal sm:hidden ${row.available < 0 ? "text-(--danger)" : "text-(--ink-soft)"}`} data-testid="yearly-row-summary">
          อนุมัติ {fmtDays(row.used)} · รอ {fmtDays(row.pending)} · เหลือ {fmtDays(row.available)}
        </span>
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={366}
            step={0.5}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`จำนวนวันของ ${row.name}`}
            className={`h-8 w-20 rounded-md border bg-(--bg) px-2 text-sm ${dirty ? "border-(--brand-navy) ring-1 ring-(--brand-navy)" : "border-(--line)"}`}
          />
          {dirty && <span className="text-[11px] font-semibold text-(--brand-navy)">แก้แล้ว</span>}
        </div>
        {error && <p className="mt-1 text-xs text-(--danger)">{error}</p>}
      </td>
      <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{fmtDays(row.used)}</td>
      <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{fmtDays(row.pending)}</td>
      <td className={`hidden py-2 text-right font-semibold tabular-nums sm:table-cell ${row.available < 0 ? "text-(--danger)" : ""}`}>{fmtDays(row.available)}</td>
    </tr>
  );
}
