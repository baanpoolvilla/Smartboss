import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { AppScaffold } from "@/components/module/app-scaffold";
import { CreateRun } from "@/modules/salary/components/create-run";
import { SalaryTabs } from "@/modules/salary/components/tabs";
import { STATUS_LABEL, card } from "@/modules/salary/components/ui";
import { MySlipList } from "@/modules/salary/components/my-slips";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { ensureDefaultItems } from "@/modules/salary/lib/items";
import { salaryPage } from "@/modules/salary/lib/page";
import { listRuns, listStaff } from "@/modules/salary/lib/views";
import { bangkokToday, fmtBaht, periodDates, periodLabel, shiftPeriod, thaiDate } from "@/modules/salary/lib/types";
import { loadRequests } from "@/modules/requests/lib/db";
import { loadScorePeriodConfig } from "@/lib/score-period-config";
import { bangkokDay, scorePeriodRange } from "@/lib/score-period";

export const dynamic = "force-dynamic";

/**
 * เงินเดือน — พนักงานทั่วไปเห็นสลิปของตัวเอง · CEO + คนที่ CEO เลือกเห็น "รายการเงินเดือน"
 * (แบบหน้า รายการเงินเดือน/ค่าจ้าง ของ FlowAccount: ช่วงวันที่ · วันที่ชำระ · รวมเงินเดือน · ยอดจ่ายสุทธิ · สถานะ)
 */
export default async function SalaryHome() {
  const { session, access } = await salaryPage();
  if (!access.canEdit) {
    return (
      <AppScaffold title="สลิปเงินเดือน" width="max-w-2xl">
        <MySlipList orgId={session.orgId} userId={session.userId} />
      </AppScaffold>
    );
  }
  const orgId = session.orgId;
  const settings = await withSalaryTenant(orgId, async (tx) => {
    await ensureDefaultItems(tx, orgId);
    return readSettings(tx, orgId);
  });
  const runs = await listRuns(orgId);
  const open = runs.find((r) => r.status !== "paid");
  // งวดถัดไป: ต่อจากงวดล่าสุด · ยังไม่มีเลย = งวดที่วันนี้อยู่
  const today = bangkokToday();
  const thisPeriod = (() => {
    const p = today.slice(0, 7);
    return periodDates(p, settings.cutoffDay, settings.payDay).endsOn >= today ? p : shiftPeriod(p, 1);
  })();
  const nextPeriod = runs[0] ? shiftPeriod(runs[0].period, 1) : thisPeriod;
  const grade = await loadScorePeriodConfig(orgId);
  const d = periodDates(nextPeriod, settings.cutoffDay, settings.payDay);
  // งวดแรก: ไม่เริ่มก่อนรอบเกรด — รอบเกรดแรกเริ่ม 1 ต.ค. (ก.ย. ตัดแบบเดือนเต็มไปแล้ว) ⇒ ไม่นับ 26–30 ก.ย. ซ้ำกับเงินเดือนแบบเดิม
  if (runs.length === 0) {
    const gradeStart = bangkokDay(scorePeriodRange(grade, nextPeriod).from);
    if (gradeStart > d.startsOn && gradeStart <= d.endsOn) d.startsOn = gradeStart;
  }
  // งวดแรกดึง OT ที่อนุมัติแต่ยังไม่จ่าย/เบิกที่ยังไม่หัก "ทั้งหมด" — โชว์ให้ HR ปิดใบที่จ่ายนอกระบบไปแล้วก่อน
  const carried =
    runs.length === 0
      ? await withSalaryTenant(orgId, async (tx) => {
          const [ot, adv] = await Promise.all([
            loadRequests(tx, orgId, { kind: "ot", status: "approved", beneficiaryKind: "staff" }, 2000),
            loadRequests(tx, orgId, { beneficiaryKind: "staff", deductedAt: null, deductAmount: { gt: 0 } }, 2000),
          ]);
          return { otDates: ot.filter((r) => r.netAmount - r.paidTotal > 0).map((r) => r.workDate).filter(Boolean), advances: adv.length };
        })
      : null;
  const staff = runs.length === 0 ? await listStaff(orgId) : [];
  const noSalary = staff.filter((s) => s.salary === null).length;
  const noBank = staff.filter((s) => s.profile.payChannel === "transfer" && !s.profile.bankAccount && s.salary !== null).length;

  return (
    <AppScaffold title="เงินเดือน" width="max-w-6xl">
      <div className="flex flex-col gap-4">
        <SalaryTabs active="runs" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-(--ink)">รายการเงินเดือน</h1>
            <p className="text-xs text-(--ink-soft)">
              เห็นหน้านี้: CEO และคนที่ CEO เลือก{access.via === "super_admin" ? " · คุณเห็นในฐานะผู้ดูแลระบบสูงสุด (ช่วงติดตั้ง)" : ""}
            </p>
          </div>
          <CreateRun
            defaults={{ period: nextPeriod, periodLabel: periodLabel(nextPeriod), ...d }}
            blocked={open ? `งวด ${periodLabel(open.period)} ยังไม่ได้บันทึกจ่าย — ทำให้เสร็จก่อน` : null}
            grade={grade}
            lastEndsOn={runs[0]?.endsOn ?? null}
            carried={carried}
          />
        </div>

        {runs.length === 0 && (
          <section className={`${card} p-4`}>
            <h2 className="text-sm font-bold text-(--ink)">เริ่มต้นใช้งาน (ทำครั้งเดียว)</h2>
            <ol className="mt-2 flex flex-col gap-2 text-sm">
              <li>
                1. <Link href="/salary/settings" className="font-semibold text-(--app-strong) underline">ตั้งค่า</Link> — เลขนายจ้างประกันสังคม บัญชีจ่ายเงินเดือน วันตัดงวด/วันจ่าย{" "}
                {settings.ssoEmployerNo ? <span className="text-emerald-700">✓ ใส่แล้ว</span> : <span className="text-amber-700">ยังไม่ได้ใส่เลขนายจ้าง</span>}
              </li>
              <li>
                2. <Link href="/salary/employees" className="font-semibold text-(--app-strong) underline">รายชื่อพนักงาน</Link> — เงินเดือน วิธีรับเงิน บัญชีธนาคาร ค่าลดหย่อน{" "}
                {staff.length === 0 ? null : noSalary + noBank === 0 ? <span className="text-emerald-700">✓ ครบ {staff.length} คน</span> : <span className="text-amber-700">ยังไม่มีเงินเดือน {noSalary} คน · ขาดเลขบัญชี {noBank} คน</span>}
                <span className="block text-xs text-(--ink-soft)">เริ่มใช้กลางปี? ใส่ &quot;ยอดยกมา&quot; ของแต่ละคนด้วย ภาษีจะตรงตั้งแต่เดือนแรก</span>
              </li>
              <li>3. กด &quot;สร้างใหม่&quot; ด้านบน — ระบบเติมทุกคนให้ ตรวจ แก้เฉพาะคนที่ต่างจากปกติ แล้วส่งให้ CEO อนุมัติ</li>
            </ol>
            <p className="mt-3 text-sm">
              ไม่เคยทำเงินเดือนมาก่อน? อ่าน <Link href="/salary/guide" className="font-semibold text-(--app-strong) underline">คู่มือเงินเดือน</Link> (5 นาที) — ทำอะไรวันไหน คำศัพท์ และคำถามที่เจอบ่อย
            </p>
          </section>
        )}

        {runs.length > 0 && (
          <section className={`${card} relative overflow-x-auto`}>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">ช่วงวันที่</th>
                  <th className="px-3 py-2.5 font-semibold">วันที่ชำระ</th>
                  <th className="px-3 py-2.5 text-right font-semibold">รวมเงินได้</th>
                  <th className="px-3 py-2.5 text-right font-semibold">ยอดจ่ายรวมสุทธิ</th>
                  <th className="px-3 py-2.5 font-semibold">สถานะ</th>
                  <th className="px-3 py-2.5"><span className="sr-only">เปิด</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--line)">
                {runs.map((r) => {
                  const st = STATUS_LABEL[r.status]!;
                  return (
                    <tr key={r.id} className="hover:bg-(--bg-soft)">
                      <td className="px-4 py-3">
                        <Link href={`/salary/runs/${r.id}`} className="font-semibold text-(--ink) hover:underline">
                          {periodLabel(r.period)}
                        </Link>
                        <div className="text-xs text-(--ink-soft)">{thaiDate(r.startsOn, false)} – {thaiDate(r.endsOn)}</div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{thaiDate(r.paidOn ?? r.payDate)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtBaht(r.totals?.gross ?? 0)}</td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">
                        {fmtBaht(r.totals?.net ?? 0)}
                        <div className="text-[11px] font-normal text-(--ink-soft)">{r.totals?.people ?? 0} คน</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/salary/runs/${r.id}`} aria-label={`เปิด ${periodLabel(r.period)}`} className="inline-flex h-9 w-9 items-center justify-center rounded-(--radius) border border-(--line) hover:bg-(--bg)">
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </AppScaffold>
  );
}
