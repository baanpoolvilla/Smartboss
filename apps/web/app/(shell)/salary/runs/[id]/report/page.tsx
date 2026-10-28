import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";

import { AppScaffold } from "@/components/module/app-scaffold";
import { Notice } from "@/modules/requests/components/ui";
import { PrintButton } from "@/modules/salary/components/print-button";
import { STATUS_LABEL, card, hint, outline } from "@/modules/salary/components/ui";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { salaryPage } from "@/modules/salary/lib/page";
import { exactText, reportRow } from "@/modules/salary/lib/report";
import { fmtBaht, periodLabel, thaiDate } from "@/modules/salary/lib/types";
import { loadRun } from "@/modules/salary/lib/views";

export const dynamic = "force-dynamic";

/**
 * รายงานเงินเดือนของรอบ (ข้อกำหนด HR 28/10/2569) — ทุกคน ทุกคอลัมน์ตามสูตร พร้อมที่มา
 * ใช้ตรวจก่อนสรุป (รอบร่าง) และเก็บเป็นหลักฐาน (รอบที่จ่ายแล้ว)
 */
export default async function SalaryReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { session } = await salaryPage({ edit: true });
  const { id } = await params;
  const orgId = session.orgId;
  const run = await loadRun(orgId, id);
  if (!run) notFound();
  const settings = await withSalaryTenant(orgId, (tx) => readSettings(tx, orgId));
  const rows = run.lines.map((l) => reportRow(l));
  const blocks = [...new Set(run.lines.flatMap((l) => l.info?.blocks ?? []))];
  const anyGradeTier = rows.some((r) => r.commGradeExact !== null);
  const anyOtDays = rows.some((r) => r.otDays !== null);
  const total = (k: "base" | "commission" | "diligence" | "ot" | "addTotal" | "deductTotal" | "sso" | "tax" | "net") =>
    Math.round(rows.reduce((n, r) => n + Math.round(r[k] * 100), 0)) / 100;
  const sumExact = (k: "commGradeExact" | "commTierExact") => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const st = STATUS_LABEL[run.status]!;
  const th = "px-1.5 py-2 font-semibold";
  const td = "px-1.5 py-2 align-top";
  const listCell = `${td} min-w-[8rem] max-w-[11rem]`;
  // เงินสุทธิ + ช่องตรวจ ติดขวาเสมอ — จอเล็กเลื่อนตารางแล้วยังเห็นยอดที่ต้องโอน
  const stickyNet = "sticky right-0 bg-(--bg) shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)] print:static print:shadow-none";
  const num = `${td} text-right tabular-nums`;

  return (
    <AppScaffold title={`รายงานเงินเดือน ${periodLabel(run.period)}`} backHref={`/salary/runs/${run.id}`} width="max-w-none">
      <div className="flex flex-col gap-4">
        <section className={`${card} flex flex-wrap items-start justify-between gap-3 p-4 print:border-0 print:p-0`}>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-(--ink)">รายงานเงินเดือน {periodLabel(run.period, true)}</h1>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
            </div>
            <p className={hint}>
              รอบ {thaiDate(run.startsOn, false)} – {thaiDate(run.endsOn)} · จ่าย {thaiDate(run.paidOn ?? run.payDate)} · {rows.length} คน
              {run.computedAt && ` · คำนวณล่าสุด ${new Date(run.computedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })}`}
            </p>
            <p className={`${hint} mt-1`}>
              เงินสุทธิ = ฐานเงินเดือน + ค่าคอม Grade + ค่าคอม Tier + เบี้ยขยัน + OT + รายเพิ่ม − รายหัก − ประกันสังคม{settings.taxEnabled ? " − ภาษี" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <PrintButton />
            <a href={`/salary/runs/${run.id}/export?type=report`} className={outline}>
              <Download className="h-4 w-4" aria-hidden="true" /> Excel
            </a>
            <Link href={`/salary/runs/${run.id}`} className={outline}>กลับไปรอบเงินเดือน</Link>
          </div>
        </section>

        {run.status === "draft" &&
          (blocks.length > 0 ? (
            <Notice tone="danger">
              <strong>ตรวจก่อนสรุป — ยังสรุปไม่ได้:</strong>
              <ul className="mt-1 list-disc pl-5">
                {blocks.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </Notice>
          ) : (
            <Notice tone="ok">ตรวจก่อนสรุป: ผล Grade และคะแนน Tier ครบ · คะแนนรวมไม่เป็น 0 · ยอดทุกคนแยกคอลัมน์แล้วบวกลบกลับได้ยอดสุทธิตรงทุกสตางค์</Notice>
          ))}
        {rows.some((r) => !r.check) && <Notice tone="danger">มีแถวที่แยกคอลัมน์แล้วไม่ตรงยอดสุทธิ (✗) — แจ้งผู้ดูแลระบบ</Notice>}

        <section className={`${card} overflow-x-auto print:overflow-visible print:border-0`}>
          <table className="w-full min-w-[1080px] text-xs print:min-w-0 print:text-[9px]">
            <thead className="bg-(--bg-soft) text-left text-(--ink-soft)">
              <tr>
                <th className={th}>#</th>
                <th className={th}>ชื่อ</th>
                <th className={`${th} text-right`}>ฐานเงินเดือน</th>
                {anyGradeTier && <th className={th}>Grade / คะแนน Tier</th>}
                {anyGradeTier && <th className={`${th} text-right`}>ค่าคอม Grade</th>}
                {anyGradeTier && <th className={`${th} text-right`}>ค่าคอม Tier</th>}
                <th className={`${th} text-right`}>ค่าคอมรวม</th>
                <th className={`${th} text-right`}>เบี้ยขยัน</th>
                <th className={`${th} text-right`}>{anyOtDays ? "OT (วัน × อัตรา/วัน)" : "ยอด OT"}</th>
                <th className={th}>รายเพิ่ม</th>
                <th className={th}>รายหัก</th>
                <th className={`${th} text-right`}>ประกันสังคม</th>
                {settings.taxEnabled && <th className={`${th} text-right`}>ภาษี</th>}
                <th className={`${th} ${stickyNet} bg-(--bg-soft) text-right`}>เงินสุทธิ <span className="sr-only">และผลตรวจ</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--line)">
              {rows.map((r, i) => (
                <tr key={r.employmentId}>
                  <td className={`${td} text-(--ink-soft)`}>{i + 1}</td>
                  <td className={`${td} min-w-[7rem]`}>
                    <div className="font-semibold text-(--ink)">{r.name}</div>
                    <div className="text-(--ink-soft)">{[r.employeeCode, r.department].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className={num}>
                    {fmtBaht(r.base)}
                    {Math.abs(r.base - r.monthlySalary) > 0.004 && <div className="text-(--ink-soft)">อัตรา {fmtBaht(r.monthlySalary)}</div>}
                  </td>
                  {anyGradeTier && (
                    <td className={`${td} whitespace-nowrap`}>
                      {r.grade ? <div>{r.grade} ({r.gradeScore})</div> : "—"}
                      {r.tier !== null && <div className="text-(--ink-soft)">Tier {r.tier}</div>}
                    </td>
                  )}
                  {anyGradeTier && <td className={`${num} text-[11px]`}>{r.commGradeExact !== null ? exactText(r.commGradeExact) : "—"}</td>}
                  {anyGradeTier && <td className={`${num} text-[11px]`}>{r.commTierExact !== null ? exactText(r.commTierExact) : "—"}</td>}
                  <td className={num} title={r.commissionNote}>
                    {fmtBaht(r.commission)}
                    {r.commGradeExact === null && r.commission > 0 && r.commissionNote.startsWith("ปรับโดย") && <div className="text-amber-800">ปรับเอง</div>}
                  </td>
                  <td className={num}>
                    {fmtBaht(r.diligence)}
                    {r.diligenceStep && <div className="text-(--ink-soft)">{r.diligenceStep}</div>}
                  </td>
                  <td className={num}>
                    {fmtBaht(r.ot)}
                    {r.otDays !== null && r.otRate !== null && <div className="whitespace-nowrap text-(--ink-soft)">{r.otDays} วัน × {fmtBaht(r.otRate)}</div>}
                  </td>
                  <td className={listCell}>
                    {r.adds.length === 0 ? <span className="text-(--ink-soft)">—</span> : (
                      <ul className="flex flex-col gap-1">
                        {r.adds.map((x, j) => (
                          <li key={j} title={x.detail}>
                            <span className="tabular-nums font-semibold text-emerald-800">+{fmtBaht(x.amount)}</span> {x.label}
                            <span className="block truncate text-[11px] text-(--ink-soft)">{x.detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={listCell}>
                    {r.deducts.length === 0 ? <span className="text-(--ink-soft)">—</span> : (
                      <ul className="flex flex-col gap-1">
                        {r.deducts.map((x, j) => (
                          <li key={j} title={x.detail}>
                            <span className="tabular-nums font-semibold text-red-800">−{fmtBaht(x.amount)}</span> {x.label}
                            <span className="block truncate text-[11px] text-(--ink-soft)">{x.detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={num} title={r.ssoNote}>{r.ssoNote.startsWith("ไม่หัก") ? <span className="text-(--ink-soft)">0.00 (ไม่หัก)</span> : fmtBaht(r.sso)}</td>
                  {settings.taxEnabled && <td className={num}>{fmtBaht(r.tax)}</td>}
                  <td className={`${num} ${stickyNet} whitespace-nowrap text-sm font-bold text-(--ink)`}>
                    {fmtBaht(r.net)}{" "}
                    {r.check ? <span className="text-xs text-emerald-700" title="บวกลบคอลัมน์แล้วตรงยอดสุทธิ">✓</span> : <span className="text-xs text-red-700" title="ไม่ตรง">✗</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-(--line) bg-(--bg-soft) font-semibold">
              <tr>
                <td className={td} colSpan={2}>รวม {rows.length} คน</td>
                <td className={num}>{fmtBaht(total("base"))}</td>
                {anyGradeTier && <td className={td} />}
                {anyGradeTier && <td className={`${num} text-[11px]`}>{exactText(sumExact("commGradeExact"))}</td>}
                {anyGradeTier && <td className={`${num} text-[11px]`}>{exactText(sumExact("commTierExact"))}</td>}
                <td className={num}>{fmtBaht(total("commission"))}</td>
                <td className={num}>{fmtBaht(total("diligence"))}</td>
                <td className={num}>
                  {fmtBaht(total("ot"))}
                  {anyOtDays && <div className="font-normal text-(--ink-soft)">{rows.reduce((n, r) => n + (r.otDays ?? 0), 0)} วัน</div>}
                </td>
                <td className={td}>+{fmtBaht(total("addTotal"))}</td>
                <td className={td}>−{fmtBaht(total("deductTotal"))}</td>
                <td className={num}>{fmtBaht(total("sso"))}</td>
                {settings.taxEnabled && <td className={num}>{fmtBaht(total("tax"))}</td>}
                <td className={`${num} ${stickyNet} bg-(--bg-soft) text-sm`}>{fmtBaht(total("net"))}</td>
              </tr>
            </tfoot>
          </table>
        </section>
        {anyGradeTier && (
          <p className={hint}>
            ค่าคอม Grade / Tier แสดงแบบไม่ปัดเศษตามสูตร · &quot;ค่าคอมรวม&quot; คือยอดจ่ายจริง = Grade + Tier ปัดขึ้นที่ทศนิยม 2 ตำแหน่ง (100.012 → 100.02) · ยอดรวมทุกคนจึงอาจเกินค่าคอมรวมได้ไม่กี่สตางค์
          </p>
        )}
      </div>
    </AppScaffold>
  );
}
