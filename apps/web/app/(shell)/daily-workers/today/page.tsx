import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Fingerprint, Smartphone } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadDay } from "@/modules/daily_worker/lib/data";
import { hoursLabel } from "@/modules/daily_worker/lib/types";
import { TimeEditFix } from "@/modules/daily_worker/components/time-edit-fix";
import { syncUserToWorkforce } from "@/modules/admin/data/user-guards";

export const dynamic = "force-dynamic";

const WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const STATUS: Record<string, { text: string; cls: string }> = {
  m: { text: "มา", cls: "bg-(--tone-ok)/12 text-(--tone-ok)" },
  s: { text: "สาย", cls: "bg-(--tone-warn)/15 text-(--tone-warn)" },
  x: { text: "ขาด (ไม่ลงออก)", cls: "bg-(--tone-danger)/12 text-(--tone-danger)" },
  n: { text: "ไม่มา", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  w: { text: "ยังไม่มา", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  o: { text: "หยุด", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100" },
  l: { text: "ลา", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200" },
  r: { text: "หยุดตามกะ", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  ns: { text: "ยังไม่ผูกกะ", cls: "bg-(--tone-warn)/12 text-(--tone-warn)" },
  none: { text: "ไม่มีกะวันนั้น", cls: "bg-(--bg-soft) text-(--ink-soft)" },
};

function shiftDate(date: string, delta: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * ลงเวลาของคนงานรายวันวันเดียว — แยกจาก "ภาพรวม" ของพนักงานประจำในระบบบุคคล ("จะได้แยกกันชัดเจน")
 * ผู้ดูแลเห็นทันทีว่าใครมา/สาย/ขาด มากี่โมง กลับกี่โมง — ไม่มีตัวเงิน (เงินอยู่ที่ "จ่ายเงิน" + หน้ารายคนเท่านั้น
 * ผู้ใช้ 19/10/2569: "เงินรวมไม่ต้องคิดในลงเวลา ไม่งั้นจะซ้ำซ้อน")
 * แก้เวลาเข้า/ออกได้จากหน้านี้เลยพร้อมเหตุผล (ไปหน้างานมา สแกนไม่ทัน)
 * สถานะตามกติกาของคนงาน (19/10/2569): เข้าหลังเวลาเข้ากะ = สาย หักตามนาที · ไม่ลงออก = ขาด
 */
export default async function DailyWorkersTodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireOrg();
  if (![DW_PERMS.view, DW_PERMS.manage, DW_PERMS.override, DW_PERMS.pay].some((p) => hasPermission(session, p))) redirect("/");
  const canFix = hasPermission(session, DW_PERMS.override);

  const { date: raw } = await searchParams;
  const today = bangkokToday();
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
  const load = () =>
    loadDay(session.orgId, date).catch((error: unknown) => {
      console.error("[daily-workers/today] load failed", error);
      return null;
    });
  let data = await load();
  // คนงานที่บัญชียังไม่ผูกกับทะเบียน (อีเมลต่างกันแค่ตัวพิมพ์) — ผูกให้เลยครั้งเดียว
  if (data && data.unlinkedUserIds.length > 0) {
    for (const userId of data.unlinkedUserIds) await syncUserToWorkforce(userId, session.orgId, session.userId);
    data = await load();
  }

  const d = new Date(`${date}T12:00:00+07:00`);
  const title = `${WD[d.getUTCDay()]} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(0, 4)) + 543}`;
  const count = (s: string) => data?.rows.filter((r) => r.status === s).length ?? 0;

  return (
    <AppScaffold title="ลงเวลาคนงาน" width="max-w-none">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link href={`?date=${shiftDate(date, -1)}`} className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)" aria-label="วันก่อน">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div className="flex flex-1 items-center justify-center gap-2 rounded-full border border-(--line) bg-(--bg) py-2 text-sm font-semibold">
            {title}
            {date === today && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">วันนี้</span>}
          </div>
          {date < today ? (
            <Link href={`?date=${shiftDate(date, 1)}`} className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)" aria-label="วันถัดไป">
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-full border border-(--line) p-2 opacity-30" aria-hidden>
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>

        {!data ? (
          <div className="rounded-2xl border border-(--line) bg-(--bg) p-6 text-sm text-(--ink-soft)">อ่านข้อมูลจากระบบบุคคลไม่ได้ ลองรีเฟรชอีกครั้ง</div>
        ) : (
          <div className="rounded-2xl border border-(--line) bg-(--bg) p-4">
            <div className="mb-3">
              <b>คนงาน · {data.rows.length} คน</b>
              <p className="text-xs text-(--ink-soft)">
                มา {count("m")} · สาย {count("s")} · ขาด {count("x")} · {date === today ? `ยังไม่มา ${count("w")} · ` : ""}ไม่มา {count("n")} · หยุด/ลา{" "}
                {count("o") + count("l") + count("r")}

              </p>
            </div>
            <ul className="flex flex-col gap-2">
              {data.rows.map((r) => {
                const st = STATUS[r.status]!;
                const fixable = canFix && !!r.employmentId && !["o", "l", "r", "ns", "none"].includes(r.status);
                return (
                  <li key={r.userId} className="flex flex-col gap-2 rounded-xl border border-(--line) px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xs font-bold text-amber-700">
                        {r.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        {r.employmentId ? (
                          <Link href={`/daily-workers/w/${r.employmentId}?month=${date.slice(0, 7)}`} className="block truncate text-sm font-bold hover:underline">
                            {r.name}
                          </Link>
                        ) : (
                          <b className="block truncate text-sm">{r.name}</b>
                        )}
                        <span className="block text-xs text-(--ink-soft)">
                          {r.employeeCode ?? "หาทะเบียนไม่เจอ"} · {r.shift ? `เข้ากะ ${r.shift.slice(0, 5)} เลิก ${r.shift.slice(-5)}` : "ยังไม่ผูกกะ"}
                          {r.cell?.ot && ` · OT ${r.cell.ot.start}–${r.cell.ot.end} (${hoursLabel(r.cell.ot.minutes)})`}
                        </span>
                      </span>
                      {/* มือถือ: เวลา/ค่าแรงลงไปบรรทัดล่าง ชื่อจะได้ไม่ถูกบีบเหลือคำละบรรทัด */}
                      <span className="order-last w-full pl-12 text-left text-sm tabular-nums sm:order-none sm:w-auto sm:pl-0 sm:text-right">
                        มา <b>{r.inAt ?? "--:--"}</b> · กลับ <b>{r.outAt ?? "--:--"}</b>
                        {r.lateMin > 0 && <span className="block text-xs text-(--tone-warn)">สาย {r.lateMin} นาที</span>}
                        {r.early && <span className="block text-xs text-(--tone-warn)">กลับก่อน{r.cell?.earlyMin ? ` ${r.cell.earlyMin} นาที` : "เวลา"}</span>}

                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>
                        {r.cell?.override ? "มา (แก้แล้ว)" : st.text}
                        {r.cell?.edit && " · แก้เวลา"}
                      </span>
                      {r.source && (
                        <span className="shrink-0 text-(--ink-soft)" title={r.source === "DEVICE" ? "สแกนนิ้ว" : "มือถือ"}>
                          {r.source === "DEVICE" ? <Fingerprint className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                        </span>
                      )}
                    </div>
                    {r.cell?.override && (
                      <p className="text-xs text-(--ink-soft)">
                        แก้เป็นมาโดย {r.cell.override.byName}: {r.cell.override.reason}
                      </p>
                    )}
                    {r.cell?.edit && (
                      <p className="text-xs text-(--ink-soft)">
                        แก้เวลาโดย {r.cell.edit.byName}: {r.cell.edit.reason} · ที่สแกนจริง เข้า {r.cell.edit.scannedIn ?? "--:--"} ออก {r.cell.edit.scannedOut ?? "--:--"}
                      </p>
                    )}
                    {fixable && (
                      <TimeEditFix
                        employmentId={r.employmentId!}
                        date={date}
                        inAt={r.inAt}
                        outAt={r.outAt}
                        shiftStart={r.shift ? r.shift.slice(0, 5) : null}
                        shiftEnd={r.shift ? r.shift.slice(-5) : null}
                        cell={r.cell}
                      />
                    )}
                  </li>
                );
              })}
              {data.rows.length === 0 && <li className="py-6 text-center text-sm text-(--ink-soft)">ยังไม่มีคนงาน — ผูกบทบาท &quot;คนงาน&quot; ให้ผู้ใช้ที่หลังบ้านก่อน</li>}
            </ul>
            <p className="mt-3 text-xs text-(--ink-soft)">
              เข้าหลังเวลาเข้ากะ (ไม่มีผ่อนผัน) = สาย หักตามนาที · ออกก่อนเลิกกะ = กลับก่อน หักตามนาที · ไม่ลงออกทั้งวัน = ขาด ·
              วันละ 8 ชม. (พักเที่ยง 12–13 ไม่นับ) · ไปหน้างานมาสแกนไม่ทัน กด &quot;แก้เวลา&quot; ใส่เหตุผล · เวลาที่สแกนจริงยังเก็บไว้
            </p>
          </div>
        )}
      </div>
    </AppScaffold>
  );
}
