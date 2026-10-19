import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadMonth, summarize } from "@/modules/daily_worker/lib/data";
import { hoursLabel, minutesToHm } from "@/modules/daily_worker/lib/types";
import { WorkerRoster } from "@/modules/daily_worker/components/worker-roster";
import { syncUserToWorkforce } from "@/modules/admin/data/user-guards";

export const dynamic = "force-dynamic";

/**
 * โมดูลคนงานรายวัน — ตารางวันหยุดคน × วัน (ลงทีละหลายช่องได้) + สรุปลงเวลารายเดือน (1–สิ้นเดือน)
 * เห็นเฉพาะคนที่มีสิทธิ์ของโมดูล (modules/daily_worker/permissions.ts)
 */
export default async function DailyWorkersPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await requireOrg();
  const canView = hasPermission(session, DW_PERMS.view);
  const canManage = hasPermission(session, DW_PERMS.manage);
  const canOverride = hasPermission(session, DW_PERMS.override);
  const canPay = hasPermission(session, DW_PERMS.pay);
  if (!canView && !canManage && !canOverride && !canPay) redirect("/");

  const { month: raw } = await searchParams;
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : bangkokToday().slice(0, 7);
  const load = () =>
    loadMonth(session.orgId, month).catch((error: unknown) => {
      console.error("[daily-workers] load failed", error);
      return null;
    });
  let data = await load();
  // คนงานที่บัญชียังไม่ผูกกับทะเบียน (อีเมลต่างกันแค่ตัวพิมพ์) — ผูกให้เลยครั้งเดียว ไม่ต้องให้แอดมินไปกดบันทึกผู้ใช้
  // คนเหล่านี้ลงเวลาในมือถือได้ทันทีหลังผูก · คนที่ผูกแล้วไม่ถูกแตะ
  if (data && data.unlinkedUserIds.length > 0) {
    for (const userId of data.unlinkedUserIds) await syncUserToWorkforce(userId, session.orgId, session.userId);
    data = await load();
  }

  return (
    <AppScaffold title="คนงานรายวัน" width="max-w-none">
      {!data ? (
        <div className="rounded-2xl border border-(--line) bg-(--bg) p-6 text-sm text-(--ink-soft)">
          อ่านข้อมูลจากระบบบุคคลไม่ได้ ลองรีเฟรชอีกครั้ง ถ้ายังไม่ได้ แจ้งไอที
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <WorkerRoster data={data} canManage={canManage} canOverride={canOverride} />

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">สรุปลงเวลา · ทั้งเดือน{data.today.startsWith(month) ? " (ถึงวันนี้)" : ""}</h2>
            <div className="overflow-x-auto rounded-2xl border border-(--line) bg-(--bg)">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-(--bg-soft) text-xs text-(--ink-soft)">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">ชื่อ</th>
                    <th className="px-3 py-2 text-left font-semibold">กะ</th>
                    <th className="px-3 py-2 text-right font-semibold">มา</th>
                    <th className="px-3 py-2 text-right font-semibold">สาย</th>
                    <th className="px-3 py-2 text-right font-semibold">ขาด</th>
                    <th className="px-3 py-2 text-right font-semibold">กลับก่อน</th>
                    <th className="px-3 py-2 text-right font-semibold">ไม่มา</th>
                    <th className="px-3 py-2 text-right font-semibold">หยุด/ลา</th>
                    <th className="px-3 py-2 text-right font-semibold">OT</th>

                  </tr>
                </thead>
                <tbody>
                  {data.workers.map((w) => {
                    const s = summarize(w);
                    const dash = !w.shiftId;
                    return (
                      <tr key={w.userId} className="border-t border-(--line)">
                        <td className="px-3 py-2 font-medium">
                          {w.employmentId ? (
                            <Link href={`/daily-workers/w/${w.employmentId}?month=${month}`} className="hover:underline">
                              {w.name}
                            </Link>
                          ) : (
                            w.name
                          )}
                        </td>
                        <td className="px-3 py-2 text-(--ink-soft)">{w.shiftId ? `${minutesToHm(w.shiftStart)}–${minutesToHm(w.shiftEnd)}` : "ยังไม่ผูกกะ"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.present}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-(--tone-warn)">{dash ? "—" : s.late ? `${s.late} (${s.lateMin} น.)` : 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-(--tone-danger)">{dash ? "—" : s.absent}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{dash ? "—" : s.early ? `${s.early} (${s.earlyMin} น.)` : 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.noShow}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.off + s.leave}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.otMinutes ? hoursLabel(s.otMinutes) : "0"}</td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-(--ink-soft)">
              คนงานไม่คิดคะแนน · สาย = ลงเข้าหลังเวลาเข้ากะ (ไม่มีผ่อนผัน) · ขาด = ไม่ลงออกทั้งวัน (ไม่ได้ค่าแรง) · กดชื่อดูบัญชีรายคน ·
              ตัวเงินดูที่{" "}
              <Link href={`/daily-workers/pay?month=${month}`} className="font-semibold underline">
                จ่ายเงิน
              </Link>
            </p>
          </section>
        </div>
      )}
    </AppScaffold>
  );
}
