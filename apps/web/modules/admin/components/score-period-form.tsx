import { Button } from "@smartboss/ui/components/button";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import { cutoffDayOf, scorePeriodLabel, scorePeriodOf, shiftPeriodMonth, type ScorePeriodConfig } from "@/lib/score-period";
import { monthDisplay } from "@/lib/performance-month";
import { saveScorePeriodAction } from "@/app/(shell)/admin/actions";

/**
 * ตั้งวันตัดรอบเกรด (lib/score-period.ts) — วันปกติของทุกเดือน และเปลี่ยนเฉพาะเดือนได้
 * (รอบปัจจุบัน + 2 รอบถัดไป · รอบที่ผ่านไปแล้วแก้ไม่ได้ ดู saveScorePeriodAction)
 * ใช้ในหน้าตั้งค่าเกณฑ์คะแนน ทั้ง /hr/settings/scoring และ /admin/performance/settings
 */
export function ScorePeriodForm({ period, orgId }: { period: ScorePeriodConfig; orgId?: string }) {
  const current = scorePeriodOf(period, new Date());
  const months = [current, shiftPeriodMonth(current, 1), shiftPeriodMonth(current, 2)];

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
              max={28}
              required
              className={inputClass}
            />
          </Field>
        </div>

        <p className="mt-4 mb-1 text-xs font-medium text-(--ink)">เปลี่ยนวันตัดรอบเฉพาะเดือน</p>
        <p className="mb-2 text-xs text-(--ink-soft)">
          เว้นว่าง = ใช้วันปกติ · เปลี่ยนแล้วรอบถัดไปเริ่มวันถัดจากวันนั้น · รอบที่ผ่านไปแล้วแก้ไม่ได้
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

        <div className="mt-4">
          <Button type="submit" size="sm">
            บันทึกวันตัดรอบ
          </Button>
        </div>
      </SectionCard>
    </form>
  );
}
