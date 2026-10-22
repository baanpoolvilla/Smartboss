import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText, Printer } from "lucide-react";

import { AppScaffold } from "@/components/module/app-scaffold";
import { Notice } from "@/modules/requests/components/ui";
import { IncludeButton } from "@/modules/salary/components/include-button";
import { LineEditor, type EditorData } from "@/modules/salary/components/line-editor";
import { ApproveBar, PayDialog, RecomputeButton, RunNote, SubmitButton } from "@/modules/salary/components/run-actions";
import { STATUS_LABEL, card, hint, outline } from "@/modules/salary/components/ui";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { salaryPage } from "@/modules/salary/lib/page";
import { approvalSummary, loadRun, type ChangeItem } from "@/modules/salary/lib/views";
import { fmtBaht, periodLabel, thaiDate } from "@/modules/salary/lib/types";

export const dynamic = "force-dynamic";

const TAG: Record<ChangeItem["tag"], { text: string; cls: string }> = {
  manual: { text: "HR เพิ่ม/หักเอง", cls: "bg-sky-100 text-sky-900" },
  recurring: { text: "รายการใหม่ (ประจำ/ผ่อน)", cls: "bg-sky-100 text-sky-900" },
  override: { text: "ปรับยอดเอง", cls: "bg-amber-100 text-amber-900" },
  salary: { text: "เงินเดือนเปลี่ยน", cls: "bg-slate-100 text-slate-800" },
  ot: { text: "OT สูงกว่าปกติ", cls: "bg-orange-100 text-orange-900" },
  new: { text: "คนใหม่", cls: "bg-emerald-100 text-emerald-900" },
  left: { text: "ออก/ไม่อยู่", cls: "bg-rose-100 text-rose-900" },
  skipped: { text: "ไม่ได้เงินงวดนี้", cls: "bg-red-100 text-red-900" },
  exempt: { text: "ไม่หักประกันสังคม", cls: "bg-slate-100 text-slate-800" },
  deferred: { text: "เลื่อนหักเบิก", cls: "bg-violet-100 text-violet-900" },
  warning: { text: "ตรวจ", cls: "bg-amber-100 text-amber-900" },
};

/**
 * หน้าเอกสารรอบเงินเดือน (แบบ "สร้าง/แก้ไขรายการเงินเดือน" ของ FlowAccount):
 * วันที่ · ยอดรวมเงินเดือน/รวมจ่ายสุทธิตัวใหญ่ · ตารางรายคน (ช่องทาง · เงินเดือน · ปรับเพิ่ม ↑ · ปรับลด ↓ · สุทธิ · แก้ไข)
 * · สรุปยอดด้านล่าง · โน้ต · ประวัติ — CEO เห็นสรุป "สิ่งที่เปลี่ยน" + ปุ่มอนุมัติเมื่อรออนุมัติ
 */
export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { session, access } = await salaryPage({ edit: true });
  const { id } = await params;
  const sp = await searchParams;
  const orgId = session.orgId;
  const run = await loadRun(orgId, id);
  if (!run) notFound();
  const settings = await withSalaryTenant(orgId, (tx) => readSettings(tx, orgId));
  const items = await withSalaryTenant(orgId, (tx) => tx.salaryItem.findMany({ where: { orgId, active: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] }));
  const st = STATUS_LABEL[run.status]!;
  const editable = run.status === "draft";
  const t = run.totals ?? { people: 0, gross: 0, deductions: 0, net: 0, ssoEmployee: 0, ssoEmployer: 0, tax: 0, transferNet: 0, cashNet: 0, skipped: [], warnings: 0, negatives: 0 };
  const summary = run.status === "submitted" || run.status === "approved" ? await approvalSummary(orgId, run) : null;
  const salaryTotal = run.lines.reduce((s, l) => s + (l.lines.find((x) => x.source === "salary")?.amount ?? 0), 0);
  const editLine = sp.edit ? run.lines.find((l) => l.employmentId === sp.edit) : undefined;
  const editor: EditorData | null = editLine
    ? {
        runId: run.id,
        employmentId: editLine.employmentId,
        name: editLine.name,
        department: editLine.department,
        employeeCode: editLine.employeeCode,
        // คนทำเงินเดือน (ไม่ใช่ CEO) แก้บรรทัดของตัวเองไม่ได้ — server กันซ้ำ
        editable: editable && !(editLine.userId === session.userId && !access.isCeo),
        ownLocked: editable && editLine.userId === session.userId && !access.isCeo,
        expectUpdatedAt: editLine.updatedAt,
        lines: editLine.lines,
        adjustments: editLine.adjustments,
        overrides: { sso: editLine.info?.overrides?.sso, tax: editLine.info?.overrides?.tax },
        deferred: editLine.info?.deferredAdvances ?? [],
        items: items.map((i) => ({ id: i.id, name: i.name, kind: i.kind as "earning" | "deduction", taxable: i.taxable, ssoBase: i.ssoBase })),
        gross: editLine.gross,
        deductions: editLine.deductions,
        net: editLine.net,
        ssoEmployer: editLine.ssoEmployer,
        ssoComputed: editLine.info?.ssoComputed ?? editLine.ssoEmployee,
        taxComputed: editLine.info?.taxComputed ?? editLine.tax,
        warnings: editLine.warnings,
        closeHref: `/salary/runs/${run.id}`,
        employeeHref: `/salary/employees/${editLine.employmentId}`,
        slipHref: `/salary/runs/${run.id}/slip/${editLine.employmentId}`,
      }
    : null;
  const steps = [
    { id: "draft", text: "เตรียม · ตรวจ" },
    { id: "submitted", text: "CEO อนุมัติ" },
    { id: "approved", text: "โอนเงิน" },
    { id: "paid", text: "จ่ายแล้ว · ส่งสลิป" },
  ];
  const stepIdx = steps.findIndex((s) => s.id === run.status);

  return (
    <AppScaffold title={`เงินเดือน ${periodLabel(run.period)}`} backHref="/salary" width="max-w-6xl">
      <div className="flex flex-col gap-4">
        {/* หัวเอกสาร */}
        <section className={`${card} flex flex-col gap-4 p-4 sm:p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-(--ink)">เงินเดือน {periodLabel(run.period, true)}</h1>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div><dt className={hint}>ช่วงวันที่</dt><dd className="font-medium text-(--ink)">{thaiDate(run.startsOn, false)} – {thaiDate(run.endsOn)}</dd></div>
                <div><dt className={hint}>วันที่ชำระ</dt><dd className="font-medium text-(--ink)">{thaiDate(run.paidOn ?? run.payDate)}</dd></div>
                <div><dt className={hint}>คำนวณล่าสุด</dt><dd className="text-(--ink)">{run.computedAt ? new Date(run.computedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }) : "—"}</dd></div>
              </dl>
            </div>
            <div className="flex gap-6 text-right">
              <div><div className={hint}>ยอดรวมเงินได้</div><div className="text-2xl font-bold tabular-nums text-(--ink-soft)">{fmtBaht(t.gross)}</div></div>
              <div><div className={hint}>รวมจ่ายสุทธิ</div><div className="text-3xl font-bold tabular-nums text-(--ink)">{fmtBaht(t.net)}</div></div>
            </div>
          </div>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="ขั้นตอน">
            {steps.map((s, i) => (
              <li key={s.id} className={`flex items-center gap-2 rounded-(--radius) border px-3 py-2 text-xs font-semibold ${i < stepIdx ? "border-emerald-200 bg-emerald-50 text-emerald-900" : i === stepIdx ? "border-(--brand-navy,#1b2537) text-(--ink)" : "border-(--line) text-(--ink-soft)"}`} aria-current={i === stepIdx ? "step" : undefined}>
                <span aria-hidden="true">{i < stepIdx ? "✓" : i + 1}</span> {s.text}
              </li>
            ))}
          </ol>
          {run.returnedReason && run.status === "draft" && <Notice tone="warn">ถูกส่งกลับให้แก้: {run.returnedReason}</Notice>}
          {/* ปุ่มตามขั้น */}
          <div className="flex flex-wrap items-start justify-end gap-2">
            {run.status === "draft" && (
              <>
                <RecomputeButton runId={run.id} />
                <SubmitButton runId={run.id} mode={settings.approvalMode} negatives={t.negatives} />
              </>
            )}
            {run.status === "submitted" && !access.canApprove && <Notice tone="info">ส่งให้ CEO แล้ว{run.submittedByName ? ` โดย ${run.submittedByName}` : ""} — รออนุมัติ</Notice>}
            {run.status === "approved" && (
              <>
                {access.canApprove && <ApproveBar runId={run.id} net={t.net} canApprove approved />}
                {/* ขั้น 3 โอนเงิน: ต้องได้ไฟล์โอนก่อนโอนจริง แล้วค่อยกดบันทึกจ่าย */}
                <a href={`/salary/runs/${run.id}/export?type=bank`} className={outline}><Download className="h-4 w-4" aria-hidden="true" /> ไฟล์โอนธนาคาร</a>
                <PayDialog
                  runId={run.id}
                  period={`${thaiDate(run.startsOn)} – ${thaiDate(run.endsOn)}`}
                  payDate={run.payDate}
                  people={t.people}
                  transferNet={t.transferNet}
                  cashNet={t.cashNet}
                  rows={run.lines.map((l) => ({ name: l.name, channel: l.payChannel === "cash" ? "เงินสด" : `${l.bankName || "ธนาคาร"} ${l.bankAccount ? `•••${l.bankAccount.slice(-4)}` : "ยังไม่มีเลขบัญชี"}`, net: l.net }))}
                />
              </>
            )}
            {run.status === "paid" && (
              <div className="flex flex-wrap gap-2">
                <Link href={`/salary/slips/${run.id}`} className={outline} target="_blank"><Printer className="h-4 w-4" aria-hidden="true" /> พิมพ์/ดาวน์โหลดสลิปทั้งหมด</Link>
                <a href={`/salary/runs/${run.id}/export?type=bank`} className={outline}><Download className="h-4 w-4" aria-hidden="true" /> ไฟล์โอนธนาคาร</a>
                <a href={`/salary/runs/${run.id}/export?type=sso`} className={outline}><Download className="h-4 w-4" aria-hidden="true" /> สรุปประกันสังคม</a>
                <a href={`/salary/runs/${run.id}/export?type=pnd1`} className={outline}><Download className="h-4 w-4" aria-hidden="true" /> สรุป ภ.ง.ด.1</a>
                <a href={`/salary/runs/${run.id}/export?type=summary`} className={outline}><FileText className="h-4 w-4" aria-hidden="true" /> Excel สรุปทั้งงวด</a>
              </div>
            )}
          </div>
        </section>

        {/* CEO: สรุปสิ่งที่เปลี่ยน + อนุมัติ */}
        {run.status === "submitted" && summary && (
          <section className={`${card} flex flex-col gap-3 border-2 border-(--brand-navy,#1b2537) p-4 sm:p-5`}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-(--ink)">{access.canApprove ? "รอคุณอนุมัติ" : "รอ CEO อนุมัติ"}</h2>
                <p className="text-sm text-(--ink-soft)">
                  ต้องโอนให้พนักงาน {t.people} คน รวม <strong className="text-(--ink)">{fmtBaht(t.net)}</strong>
                  {summary.prevNet !== null && (
                    <> · งวดก่อน ({periodLabel(summary.prevPeriod!)}) {fmtBaht(summary.prevNet)} ({t.net - summary.prevNet >= 0 ? "+" : ""}{fmtBaht(t.net - summary.prevNet)})</>
                  )}
                  {" "}· ส่งประกันสังคม {fmtBaht(t.ssoEmployee + t.ssoEmployer)} · ภาษีที่หักไว้ {fmtBaht(t.tax)}
                </p>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-(--ink)">ควรดู ({summary.changes.length})</h3>
              {summary.changes.length === 0 ? (
                <p className={hint}>ไม่มีอะไรต่างจากงวดก่อน</p>
              ) : (
                <ul className="mt-1 divide-y divide-(--line)">
                  {summary.changes.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${TAG[c.tag].cls}`}>{TAG[c.tag].text}</span>
                        <span className="text-sm font-semibold text-(--ink)">{c.who}</span>
                        <div className="text-xs text-(--ink-soft)">{c.detail}</div>
                      </div>
                      {c.amount !== null && <span className="text-sm font-bold tabular-nums">{c.amount > 0 ? "+" : ""}{fmtBaht(c.amount)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className={hint}>กดชื่อในตารางด้านล่างเพื่อดูว่าแต่ละคนได้อะไร หักอะไร คิดยังไง</p>
            <ApproveBar runId={run.id} net={t.net} canApprove={access.canApprove} approved={false} />
          </section>
        )}

        {/* ตารางรายคน */}
        <section className={`${card} relative overflow-x-auto`}>
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
              <tr>
                <th className="w-10 px-3 py-2.5 font-semibold">#</th>
                <th className="px-3 py-2.5 font-semibold">ชื่อ / รหัสพนักงาน</th>
                <th className="px-3 py-2.5 font-semibold">ช่องทางรับชำระ</th>
                <th className="px-3 py-2.5 text-right font-semibold">เงินเดือน</th>
                <th className="px-3 py-2.5 text-right font-semibold">รวมปรับเพิ่ม</th>
                <th className="px-3 py-2.5 text-right font-semibold">รวมปรับลด</th>
                <th className="px-3 py-2.5 text-right font-semibold">ยอดจ่ายสุทธิ</th>
                <th className="px-3 py-2.5"><span className="sr-only">แก้ไข</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--line)">
              {run.lines.map((l, i) => {
                const sal = l.lines.find((x) => x.source === "salary")?.amount ?? 0;
                const plus = Math.round((l.gross - sal) * 100) / 100;
                const manual = l.adjustments.length > 0 || Object.keys(l.info?.overrides ?? {}).length > 0;
                return (
                  <tr key={l.id} className={manual ? "bg-sky-50/60" : undefined}>
                    <td className="px-3 py-3 text-(--ink-soft)">{i + 1}</td>
                    <td className="px-3 py-3">
                      <Link href={`/salary/runs/${run.id}?edit=${l.employmentId}`} className="font-semibold text-(--ink) hover:underline">{l.name}</Link>
                      <div className="text-xs text-(--ink-soft)">{[l.employeeCode, l.department].filter(Boolean).join(" · ")}</div>
                      {/* มือถือ: เห็นยอดสุทธิเลยโดยไม่ต้องเลื่อนตารางไปขวา */}
                      <div className="mt-0.5 text-xs tabular-nums text-(--ink) sm:hidden">สุทธิ <strong>{fmtBaht(l.net)}</strong> · เลื่อนตารางดูรายละเอียด →</div>
                      {l.warnings.length > 0 && <div className="mt-0.5 text-xs font-medium text-amber-800">⚠ {l.warnings[0]}{l.warnings.length > 1 ? ` (+${l.warnings.length - 1})` : ""}</div>}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {l.payChannel === "cash" ? "เงินสด" : l.bankAccount ? <>{l.bankName || "ธนาคาร"}<div className="text-(--ink-soft)">•••{l.bankAccount.slice(-4)}</div></> : <span className="text-amber-800">ยังไม่มีเลขบัญชี</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtBaht(sal)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-emerald-800">{plus > 0 ? `${fmtBaht(plus)} ↑` : "0.00"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-red-800">({fmtBaht(l.deductions)})</td>
                    <td className={`px-3 py-3 text-right font-bold tabular-nums ${l.net < 0 ? "text-red-700" : "text-(--ink)"}`}>{fmtBaht(l.net)}</td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/salary/runs/${run.id}?edit=${l.employmentId}`} className="inline-flex h-9 items-center rounded-(--radius) border border-(--line) px-3 text-xs font-medium hover:bg-(--bg-soft)">
                        {editable ? "แก้ไข" : "ดู"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {run.lines.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-(--ink-soft)">ยังไม่มีพนักงานรายเดือนที่มีเงินเดือนในงวดนี้ — ใส่เงินเดือนที่ &quot;รายชื่อพนักงาน&quot; แล้วกด &quot;ดึงข้อมูลใหม่&quot;</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-4">
            {(t.skipped?.length ?? 0) > 0 && (
              <section className={`${card} p-4`}>
                <h2 className="text-sm font-bold text-(--ink)">ไม่อยู่ในรอบนี้ ({t.skipped.length})</h2>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {t.skipped.map((s, i) => {
                    const ex = run.excluded.find((x) => x.name === s.name && s.reason.startsWith("ไม่จ่ายงวดนี้"));
                    return (
                      <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                        <span><strong>{s.name}</strong> — <span className="text-(--ink-soft)">{s.reason}</span></span>
                        {ex && editable && <IncludeButton runId={run.id} employmentId={ex.employmentId} />}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <section className={`${card} p-4`}>
              <h2 className="mb-2 text-sm font-bold text-(--ink)">โน้ตของรอบ</h2>
              <RunNote runId={run.id} note={run.note} editable={run.status !== "paid"} />
            </section>
            <section className={`${card} p-4`}>
              <h2 className="text-sm font-bold text-(--ink)">ประวัติ</h2>
              <ol className="mt-2 flex flex-col gap-2">
                {run.events.map((e) => (
                  <li key={e.id} className="text-xs">
                    <span className="text-(--ink-soft)">{new Date(e.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })} · {e.byName}</span>
                    <div className="text-sm text-(--ink)">{e.summary}</div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
          <section className={`${card} flex h-fit flex-col gap-1.5 p-4 text-sm`}>
            <div className="flex justify-between"><span>จำนวนพนักงาน</span><span className="font-semibold">{t.people} คน</span></div>
            <div className="flex justify-between"><span>ยอดรวมเงินเดือน</span><span className="tabular-nums">{fmtBaht(salaryTotal)}</span></div>
            <div className="flex justify-between"><span>รวมรายการปรับเพิ่ม</span><span className="tabular-nums text-emerald-800">{fmtBaht(t.gross - salaryTotal)}</span></div>
            <div className="flex justify-between"><span>รวมรายการปรับลด</span><span className="tabular-nums text-red-800">({fmtBaht(t.deductions)})</span></div>
            <div className="flex justify-between border-t border-(--line) pt-1.5 text-base font-bold"><span>รวมจ่ายสุทธิ</span><span className="tabular-nums">{fmtBaht(t.net)}</span></div>
            <div className="mt-2 flex justify-between text-xs text-(--ink-soft)"><span>โอนเข้าบัญชี / เงินสด</span><span className="tabular-nums">{fmtBaht(t.transferNet)} / {fmtBaht(t.cashNet)}</span></div>
            <div className="flex justify-between text-xs text-(--ink-soft)"><span>ประกันสังคม ลูกจ้าง + บริษัท</span><span className="tabular-nums">{fmtBaht(t.ssoEmployee)} + {fmtBaht(t.ssoEmployer)}</span></div>
            <div className="flex justify-between text-xs text-(--ink-soft)"><span>ภาษีหัก ณ ที่จ่าย (นำส่ง)</span><span className="tabular-nums">{fmtBaht(t.tax)}</span></div>
            {run.status === "paid" && <div className="flex justify-between text-xs text-(--ink-soft)"><span>ค่าธรรมเนียมโอน</span><span className="tabular-nums">{fmtBaht(run.bankFee)}</span></div>}
          </section>
        </div>
      </div>
      {editor && <LineEditor d={editor} />}
    </AppScaffold>
  );
}
