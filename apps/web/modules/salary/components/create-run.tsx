"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { createRunAction } from "../actions";
import { Notice } from "@/modules/requests/components/ui";
import { field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";
import { addDays, periodLabel, thaiDate } from "../lib/types";
import { bangkokDay, hasPassed, scorePeriodLabel, scorePeriodRange, scorePeriodReadyAt, type ScorePeriodConfig } from "@/lib/score-period";

/** "สร้างใหม่" — เติมช่วงวันที่/วันจ่ายตามตั้งค่าให้ แก้ได้ก่อนกด (FlowAccount: วันที่ทำรายการ / ช่วงวันที่ / วันที่ชำระ) */
export function CreateRun({
  defaults,
  blocked,
  grade,
  lastEndsOn,
  carried,
}: {
  defaults: { period: string; periodLabel: string; startsOn: string; endsOn: string; payDate: string };
  blocked: string | null;
  /** รอบเกรดของบริษัท — เทียบช่วงงวดกับรอบเกรด/ค่าคอม */
  grade: ScorePeriodConfig;
  /** วันตัดของงวดล่าสุด — เช็ควันตกหล่น/ทับ · null = งวดแรก */
  lastEndsOn: string | null;
  /** งวดแรกเท่านั้น: OT ที่อนุมัติแต่ยังไม่จ่าย (วันทำงาน) + เบิกที่ยังไม่หัก ที่จะถูกดึงเข้างวด */
  carried: { otDates: string[]; advances: number } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(defaults);
  const { busy, error, run } = useRun();
  if (!open) {
    return (
      <button type="button" className={navy} onClick={() => setOpen(true)} disabled={!!blocked} title={blocked ?? undefined}>
        <Plus className="h-4 w-4" aria-hidden="true" /> สร้างใหม่
      </button>
    );
  }

  // รอบเกรด/ค่าคอมของเดือนงวดนี้ — ช่วงไม่ตรงกัน = เกรดกับค่าคอมนับคนละช่วงกับลา/ขาด/OT ในงวด
  const gradeRange = scorePeriodRange(grade, v.period);
  const gradeStart = bangkokDay(gradeRange.from);
  const gradeEnd = bangkokDay(gradeRange.to);
  const offGrade = v.startsOn !== gradeStart || v.endsOn !== gradeEnd;
  const readyAt = scorePeriodReadyAt(grade, v.period);
  const gradeReady = hasPassed(readyAt);
  // ต่อจากงวดก่อน — ห่างกัน = วันตรงกลางไม่อยู่ในงวดไหน (ลาไม่รับเงิน/ขาดหลุด) · ทับ = ระบบไม่ให้สร้าง
  const expectedStart = lastEndsOn ? addDays(lastEndsOn, 1) : null;
  const gap = expectedStart && v.startsOn > expectedStart ? { from: expectedStart, to: addDays(v.startsOn, -1) } : null;
  const overlap = !!lastEndsOn && !!v.startsOn && v.startsOn <= lastEndsOn;
  const oldOt = carried ? carried.otDates.filter((d) => d < v.startsOn).sort() : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="สร้างรอบเงินเดือน">
      <div className="flex max-h-[95dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-(--radius-lg) bg-(--bg) p-5 sm:rounded-(--radius-lg)">
        <div>
          <h2 className="text-lg font-bold text-(--ink)">สร้างรายการเงินเดือน {periodLabel(v.period)}</h2>
          <p className={hint}>ระบบเติมรายชื่อพนักงานรายเดือนทุกคน พร้อมเงินเดือน OT เบิกล่วงหน้า ลา และรายการประจำให้เอง</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            <span className={labelText}>ช่วงวันที่ (ตั้งแต่)</span>
            <input type="date" className={field} value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} />
          </label>
          <label className={label}>
            <span className={labelText}>ถึงวันที่ (ตัดงวด)</span>
            <input type="date" className={field} value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value, period: e.target.value.slice(0, 7) || v.period })} />
          </label>
          <label className={`${label} col-span-2 sm:col-span-1`}>
            <span className={labelText}>วันที่ชำระ (วันจ่าย)</span>
            <input type="date" className={field} value={v.payDate} onChange={(e) => setV({ ...v, payDate: e.target.value })} />
          </label>
        </div>
        {v.startsOn && v.endsOn && (
          <p className="text-sm text-(--ink)">
            เงินเดือนจ่ายเต็มเดือน · นับลา ขาด สาย และ OT ของวันที่ <b>{thaiDate(v.startsOn, false)} – {thaiDate(v.endsOn)}</b> · ที่เกิดหลังวันที่{" "}
            {thaiDate(v.endsOn, false)} ไปอยู่งวดถัดไป
          </p>
        )}
        <p className={hint}>งวดนับตามเดือนของวันตัดงวด · แก้วันจ่ายได้เฉพาะงวดนี้ (ค่าเริ่มต้นตั้งที่ ตั้งค่า)</p>

        {overlap && <Notice tone="danger">วันเริ่มทับกับงวดก่อน (จบ {thaiDate(lastEndsOn!)}) — ต้องเริ่ม {thaiDate(expectedStart!)}</Notice>}
        {gap && (
          <Notice tone="warn">
            วันที่ {thaiDate(gap.from, false)} – {thaiDate(gap.to)} ไม่อยู่ในงวดไหน — ลาไม่รับเงิน/ขาดของช่วงนี้จะไม่ถูกหัก (งวดก่อนจบ {thaiDate(lastEndsOn!)})
          </Notice>
        )}
        {offGrade && (
          <Notice tone="warn">
            ช่วงนี้ไม่ตรงกับรอบเกรด {scorePeriodLabel(grade, v.period)} — เกรดและค่าคอมของงวดนี้ใช้รอบเกรดนั้น ส่วนลา/ขาด/OT ใช้ช่วงที่กรอกข้างบน
          </Notice>
        )}
        {!gradeReady && (
          <Notice tone="warn">
            เกรด/ค่าคอมรอบนี้พร้อม{" "}
            {readyAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} น. — สร้างก่อนได้
            แต่ต้องกด &quot;ดึงข้อมูลใหม่&quot; หลังจากนั้นค่าคอมจึงจะเข้า
          </Notice>
        )}
        {carried && (oldOt.length > 0 || carried.advances > 0) && (
          <Notice tone="warn">
            งวดแรกจะรวมของค้างจากก่อนเริ่มใช้ระบบ:
            {oldOt.length > 0 && ` OT ที่อนุมัติแต่ยังไม่จ่าย ${oldOt.length} ใบ (วันที่ ${thaiDate(oldOt[0]!, false)} – ${thaiDate(oldOt[oldOt.length - 1]!)})`}
            {oldOt.length > 0 && carried.advances > 0 && " ·"}
            {carried.advances > 0 && ` เบิกล่วงหน้าที่ยังไม่หัก ${carried.advances} ใบ`} — ถ้าจ่าย/หักกับเงินเดือนแบบเดิมไปแล้ว ให้ปิดใบที่{" "}
            <Link href="/requests" className="underline">
              เบิกจ่าย &amp; OT
            </Link>{" "}
            ก่อน ไม่งั้นจะจ่าย/หักซ้ำ
          </Notice>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>
            ยกเลิก
          </button>
          <button
            type="button"
            className={navy}
            disabled={busy || !v.startsOn || !v.endsOn || !v.payDate || overlap}
            onClick={() =>
              run(
                async () => {
                  const res = await createRunAction(v);
                  if (res.ok) router.push(`/salary/runs/${res.id}`);
                  return res;
                },
              )
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} สร้างและคำนวณ
          </button>
        </div>
      </div>
    </div>
  );
}
