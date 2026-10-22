import Link from "next/link";

import { AppScaffold } from "@/components/module/app-scaffold";
import { SalaryTabs } from "@/modules/salary/components/tabs";
import { card } from "@/modules/salary/components/ui";
import { salaryPage } from "@/modules/salary/lib/page";
import { listStaff } from "@/modules/salary/lib/views";
import { fmtBaht, thaiDate } from "@/modules/salary/lib/types";

export const dynamic = "force-dynamic";

/** รายชื่อพนักงานรายเดือน (ตั้งครั้งเดียว) — บอกชัดว่าใครข้อมูลยังไม่ครบ */
export default async function SalaryEmployeesPage() {
  const { session } = await salaryPage({ edit: true });
  const staff = await listStaff(session.orgId);
  const incomplete = staff.filter((s) => s.problems.length > 0).length;
  return (
    <AppScaffold title="เงินเดือน" width="max-w-6xl">
      <div className="flex flex-col gap-4">
        <SalaryTabs active="employees" />
        <div>
          <h1 className="text-lg font-bold text-(--ink)">รายชื่อพนักงาน (รายเดือน)</h1>
          <p className="text-xs text-(--ink-soft)">
            ตั้งครั้งเดียว ทุกเดือนระบบใช้ข้อมูลนี้เอง · พนักงานใหม่เพิ่มที่ระบบบุคคล แล้วมาใส่เงินเดือนที่นี่ · คนงานรายวันอยู่ที่โมดูลคนงาน
            {incomplete > 0 && <strong className="text-amber-800"> · ข้อมูลยังไม่ครบ {incomplete} คน</strong>}
          </p>
        </div>
        <section className={`${card} relative overflow-x-auto`}>
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
              <tr>
                <th className="px-4 py-2.5 font-semibold">พนักงาน</th>
                <th className="px-3 py-2.5 text-right font-semibold">เงินเดือน</th>
                <th className="px-3 py-2.5 font-semibold">รายการประจำ</th>
                <th className="px-3 py-2.5 font-semibold">รับเงินทาง</th>
                <th className="px-3 py-2.5 font-semibold">ประกันสังคม</th>
                <th className="px-3 py-2.5 font-semibold">ภาษี</th>
                <th className="px-3 py-2.5 font-semibold">ข้อมูล</th>
                <th className="px-3 py-2.5"><span className="sr-only">แก้ไข</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--line)">
              {staff.map((s) => (
                <tr key={s.employmentId} className="hover:bg-(--bg-soft)">
                  <td className="px-4 py-3">
                    <Link href={`/salary/employees/${s.employmentId}`} className="font-semibold text-(--ink) hover:underline">{s.name}</Link>
                    <div className="text-xs text-(--ink-soft)">
                      {[s.employeeCode, s.department, `เริ่ม ${thaiDate(s.hiredOn)}`].filter(Boolean).join(" · ")}
                      {s.terminatedOn ? ` · ออก ${thaiDate(s.terminatedOn)}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{s.salary === null ? <span className="text-red-700">ยังไม่ใส่</span> : fmtBaht(s.salary)}</td>
                  <td className="px-3 py-3 text-xs text-(--ink-soft)">{s.recurring.length ? s.recurring.map((r) => `${r.name} ${r.kind === "earning" ? "+" : "−"}${fmtBaht(r.amount)}`).join(" · ") : "—"}</td>
                  <td className="px-3 py-3 text-xs">{s.profile.payChannel === "cash" ? "เงินสด" : s.profile.bankAccount ? `${s.profile.bankName} •••${s.profile.bankAccount.slice(-4)}` : <span className="text-amber-800">ยังไม่ใส่บัญชี</span>}</td>
                  <td className="px-3 py-3 text-xs">{s.profile.ssoExempt ? "ไม่หัก" : "หัก"}</td>
                  <td className="px-3 py-3 text-xs">{s.profile.taxMode === "auto" ? `คิดให้อัตโนมัติ${s.profile.extraAllowance > 0 ? ` · ลดหย่อน ${fmtBaht(s.profile.extraAllowance)}` : ""}` : s.profile.taxMode === "fixed" ? `คงที่ ${fmtBaht(s.profile.taxFixedAmount)}` : "ไม่หัก"}</td>
                  <td className="px-3 py-3">
                    {s.problems.length === 0 ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">ครบ</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{s.problems.join(" · ")}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/salary/employees/${s.employmentId}`} className="inline-flex h-9 items-center rounded-(--radius) border border-(--line) px-3 text-xs font-medium hover:bg-(--bg)">แก้ไข</Link>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-(--ink-soft)">ยังไม่มีพนักงานรายเดือนในระบบบุคคล — เพิ่มพนักงานที่ ระบบบุคคล › พนักงาน ก่อน</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </AppScaffold>
  );
}
