import { Button } from "@smartboss/ui/components/button";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import { cutoffDayOf, editableScorePeriodMonths, scorePeriodLabel, type ScorePeriodConfig } from "@/lib/score-period";
import { monthDisplay } from "@/lib/performance-month";
import { saveScorePeriodAction } from "@/app/(shell)/admin/actions";

/**
 * ตั้งวันตัดรอบเกรด (lib/score-period.ts) — วันปกติของทุกเดือน และเปลี่ยนเฉพาะเดือนได้
 * (รอบปัจจุบัน + 11 รอบถัดไป = ตั้งล่วงหน้าได้ 1 ปี · รอบที่ผ่านไปแล้วแก้ไม่ได้ ดู saveScorePeriodAction)
 * ใช้ในหน้าตั้งค่าเกณฑ์คะแนน ทั้ง /hr/settings/scoring และ /admin/performance/settings
 */
export function ScorePeriodForm({ period, orgId }: { period: ScorePeriodConfig; orgId?: string }) {
  const months = editableScorePeriodMonths(period);
  const current = months[0];

  return (
    <form action={saveScorePeriodAction}>
      {orgId && <input type="hidden" name="orgId" value={orgId} />}
      <SectionCard
        title="วันตัดรอบเกรด"
        description="เกรดของแต่ละเดือนนับจากวันถัดจากวันตัดรอบของเดือนก่อน ถึงวันตัดรอบของเดือนนั้น พนักงานเห็นป้ายเตือนวันตัดรอบในหน้าคะแนน"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ตัดรอบทุกวันที่ (ปกติ)">
            <input
              id="score-cutoff-day"
              type="number"
              name="cutoffDay"
              defaultValue={period.cutoffDay}
              min={1}
              max={31}
              required
              className={inputClass}
            />
          </Field>
        </div>
        <p className="mt-1 text-xs text-(--ink-soft)">
          ใช้วันนี้ทุกเดือน · เดือนที่ไม่มีวันนั้น (เช่น ตั้ง 30 แต่ ก.พ. มี 28 วัน) ตัดวันสุดท้ายของเดือนแทน
        </p>

        {/* ตัวเลือกเสริม ซ่อนไว้ — ส่วนใหญ่ไม่ต้องใช้ · เปิดเองถ้ามีเดือนที่ตั้งไว้แล้ว */}
        <details className="mt-4" open={months.some((m) => period.overrides[m] !== undefined)}>
          <summary className="cursor-pointer text-xs font-medium text-(--ink)">เปลี่ยนวันตัดรอบเฉพาะบางเดือน (ไม่บังคับ)</summary>
        <p className="mt-2 mb-2 text-xs text-(--ink-soft)">
          ตั้งล่วงหน้าได้ 12 เดือน · เช่น เดือนที่ต้องปิดเงินเดือนเร็วขึ้น · เว้นว่าง = ใช้วันปกติ · เปลี่ยนแล้วรอบถัดไปเริ่มวันถัดจากวันนั้น · รอบที่ผ่านไปแล้วแก้ไม่ได้
        </p>
        <div className="flex flex-col gap-2">
          {months.map((month) => (
            <div key={month} className="flex flex-wrap items-center gap-3">
              <span className="w-28 text-sm font-medium text-(--ink)">
                {monthDisplay(month)}
                {month === current ? " (รอบนี้)" : ""}
              </span>
              <input
                id={`score-cutoff-${month}`}
                type="number"
                name={`override_${month}`}
                defaultValue={period.overrides[month] ?? ""}
                placeholder={String(period.cutoffDay)}
                min={1}
                max={31}
                className={`${inputClass} w-24`}
                aria-label={`วันตัดรอบของ ${monthDisplay(month)}`}
              />
              <span className="text-xs text-(--ink-soft)">
                ตอนนี้: ตัดวันที่ {cutoffDayOf(period, month)} · {scorePeriodLabel(period, month)}
              </span>
            </div>
          ))}
        </div>
        </details>

        <div className="mt-4">
          <Button type="submit" size="sm">
            บันทึกวันตัดรอบ
          </Button>
        </div>
      </SectionCard>
    </form>
  );
}
