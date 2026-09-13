import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import {
  DEFAULT_RULE_POINTS,
  PERFORMANCE_CATEGORIES,
  loadPerformanceSettings,
  type PerformanceCategory,
} from "@/lib/performance";
import { savePerformanceSettingsAction } from "../../actions";

/**
 * ตั้งเกณฑ์คะแนนผลงานของบริษัท
 *
 * ทุกตัวเลขที่ใช้ตัดสินว่า "ผลงานดีหรือไม่ดี" อยู่ที่นี่ — ไม่มีค่าฝังในโค้ด
 * เพราะแต่ละบริษัทมีมาตรฐานคนละแบบ บางที่สาย 5 นาทีถือว่าสาย บางที่ผ่อนผัน 30 นาที
 *
 * บริษัทที่ยังไม่เคยตั้ง จะเห็นค่าเริ่มต้นกรอกไว้ให้ กดบันทึกครั้งแรกจึงเกิดแถวจริง
 */
export const dynamic = "force-dynamic";

/** แถวเกรดว่างที่เตรียมไว้ให้กรอกเพิ่ม */
const GRADE_SPARE_ROWS = 2;

/**
 * งานและรายงาน (task_late, task_manual_dock, report_missed, report_late) ไม่มี
 * กลุ่มในนี้เลย — ทั้งสี่ตัวนี้ไม่เคยถูก rulePoints ที่ตั้งในหน้านี้พาไปใช้จริง:
 *
 *   - task_manual_dock: คะแนนมาจากสติกเกอร์ที่หัวหน้ากดบนการ์ดงาน Kanban
 *   - task_late: sweep อัตโนมัติส่งค่า points มาเองเสมอ (แก้ที่ /report-task/settings)
 *   - report_missed / report_late: ยังไม่มีฟีเจอร์ไหนสร้างเหตุการณ์สองชนิดนี้เลย
 *     (จองชื่อไว้ล่วงหน้าสำหรับ "รอบส่งรายงาน" เฟส 2 ที่ยังไม่ได้สร้าง —
 *     ดู docs/spec-report-submission-rounds.md)
 *
 * เคยแสดงเป็นช่องกรอกได้ในหน้านี้ทั้งที่ตั้งแล้วไม่มีผล — เอาออกกันเข้าใจผิด
 */
const REPORT_TASK_SETTINGS_HREF = "/report-task/settings";

/** จัดกลุ่มตามโมดูลต้นทาง ให้หาเจอง่ายกว่าเรียงยาวเป็นพืด */
const GROUPS: { title: string; hint: string; keys: PerformanceCategory[] }[] = [
  {
    title: "งานซ่อมบำรุง",
    hint: "จากโมดูลแจ้งซ่อมบำรุง — ใช้จับการปล่อยงานค้าง",
    keys: ["workorder_overdue", "pm_missed"],
  },
  {
    title: "การลงเวลา",
    hint: "จากโมดูลบุคคล — วันลาที่อนุมัติแล้วไม่ถูกนับ",
    keys: ["attendance_late", "attendance_absent"],
  },
];

export default async function PerformanceSettingsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.performanceSettingManage)) {
    redirect("/admin/performance");
  }

  const s = await loadPerformanceSettings(session.orgId);
  // แถวว่างท้ายรายการไว้เพิ่มระดับใหม่ — ฟอร์มเป็น server component จึงไม่มีปุ่ม "เพิ่มแถว"
  const gradeRows: ([string, number] | null)[] = [
    ...s.gradeThresholds,
    ...Array.from<null>({ length: GRADE_SPARE_ROWS }).fill(null),
  ];

  return (
    <AppScaffold
      title="เกณฑ์คะแนนผลงาน"
      width="max-w-3xl"
      backHref="/admin/performance"
    >
      <form action={savePerformanceSettingsAction} className="flex flex-col gap-4">
        <SectionCard
          title="เปิดใช้งาน"
          description="ปิดแล้วจะไม่มีการบันทึกเหตุการณ์ใหม่ ข้อมูลเดิมยังอยู่"
        >
          <label className="flex items-center gap-2.5 text-sm text-(--ink)">
            <input
              type="checkbox"
              name="enabled"
              value="1"
              defaultChecked={s.enabled}
              className="h-4 w-4"
            />
            เก็บคะแนนผลงานของบริษัทนี้
          </label>
        </SectionCard>

        <SectionCard
          title="คะแนนตั้งต้นและเกรด"
          description="ทุกคนเริ่มจากคะแนนตั้งต้น แล้วหักตามเหตุการณ์ที่เกิดขึ้น"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="คะแนนตั้งต้น">
              <input
                type="number"
                name="baseScore"
                defaultValue={s.baseScore}
                min={0}
                max={1000}
                required
                className={inputClass}
              />
            </Field>
          </div>

          <p className="mt-4 mb-1 text-xs font-medium text-(--ink)">เกณฑ์เกรด</p>
          <p className="mb-2 text-xs text-(--ink-soft)">
            ชื่อเกรดตั้งเองได้ (A–F, ผ่าน/ไม่ผ่าน, ดีมาก/ดี/พอใช้ …) —
            ระบบไล่จากคะแนนสูงลงต่ำ ตัวแรกที่ถึงเกณฑ์คือเกรดที่ได้
            ต่ำกว่าทุกเกณฑ์ได้ F · เว้นชื่อว่างเพื่อลบระดับนั้น
          </p>
          <div className="flex flex-col gap-2">
            {gradeRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr] gap-3">
                <input
                  type="text"
                  name="gradeName"
                  defaultValue={row?.[0] ?? ""}
                  maxLength={20}
                  placeholder="ชื่อเกรด"
                  aria-label={`ชื่อเกรดระดับที่ ${i + 1}`}
                  className={inputClass}
                />
                <input
                  type="number"
                  name="gradeMin"
                  defaultValue={row?.[1] ?? ""}
                  min={0}
                  max={1000}
                  placeholder="คะแนนขั้นต่ำ"
                  aria-label={`คะแนนขั้นต่ำระดับที่ ${i + 1}`}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="เกณฑ์การนับ"
          description="เวลาเข้างาน กะ และการผ่อนผันสาย ตั้งที่ ตั้งค่า → การลงเวลา — ตรงนี้คือผ่อนผันเพิ่มเฉพาะตอนคิดคะแนนเท่านั้น"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="ผ่อนผันการมาสายเพิ่มอีกกี่นาที"
              hint="ปกติใส่ 0 — เวลาผ่อนผันของกะ (เช่น 15 นาที) ถูกหักให้แล้วจากการลงเวลา ใส่เลขที่นี่คือผ่อนผันซ้ำอีกชั้น"
            >
              <input
                type="number"
                name="lateThresholdMinutes"
                defaultValue={s.lateThresholdMinutes}
                min={0}
                max={480}
                required
                className={inputClass}
              />
            </Field>
            <Field
              label="เริ่มนับคะแนนตั้งแต่วันที่"
              hint="เว้นว่าง = นับทั้งหมด — เหตุการณ์ก่อนวันนี้จะไม่ถูกบันทึกและไม่ถูกนับ"
            >
              <input
                type="date"
                name="scoringStartDate"
                defaultValue={s.scoringStartDate?.toISOString().slice(0, 10) ?? ""}
                className={inputClass}
              />
            </Field>
          </div>
          {/*
            เอาออกตามคำขอ — เส้นแบ่งขาดงาน (240 นาที) กับช่วงย้อนดูผลลงเวลา
            (45 วัน) ตรึงเป็นค่าคงที่ในโค้ดแทน (ABSENCE_THRESHOLD_MINUTES,
            ATTENDANCE_LOOKBACK_DAYS ใน lib/performance.ts) ไม่ให้ตั้งต่อบริษัท
          */}
        </SectionCard>

        <SectionCard
          title="งานและรายงาน"
          description="จากโมดูลรายงานและงาน"
        >
          <p className="text-sm text-(--ink-soft)">
            คะแนน &quot;ส่งงานเลยกำหนด&quot; และ &quot;หักคะแนนโดยหัวหน้า&quot;
            ตั้งแยกอยู่ที่{" "}
            <Link href={REPORT_TASK_SETTINGS_HREF} className="text-(--app-strong) underline">
              ตั้งค่าโมดูลรายงานและงาน
            </Link>{" "}
            ไม่ใช่ที่หน้านี้ — ส่วน &quot;ไม่ส่งรายงานประจำวัน&quot; และ
            &quot;ส่งรายงานสาย&quot; ยังไม่เปิดใช้งาน (ยังไม่มีฟีเจอร์ตรวจรอบ
            ส่งรายงานที่จะสร้างการหักคะแนนสองแบบนี้)
          </p>
        </SectionCard>

        {GROUPS.map((group) => (
          <SectionCard key={group.title} title={group.title} description={group.hint}>
            <div className="grid gap-3 sm:grid-cols-2">
              {/*
                ระยะผ่อนผันของ PM/ใบงานอยู่ด้วยกันกับคะแนนที่หักของสองอย่างนี้
                แทนที่จะแยกไปอยู่การ์ด "เกณฑ์การนับ" กับตัวเลขของโมดูลอื่น
                (สาย/ขาดงาน/ย้อนดูกี่วัน) — คนตั้งค่าเรื่องซ่อมบำรุงจะได้ดูจบ
                ในการ์ดเดียว ไม่ต้องเลื่อนขึ้นไปหาอีกที่
              */}
              {group.title === "งานซ่อมบำรุง" && (
                <>
                  <Field
                    label="บำรุงรักษา (PM) เกินได้กี่วัน"
                    hint="เลยกำหนดเกินกี่วันถึงถือว่าปล่อยปละละเลย — 0 = หักทันทีที่เลยกำหนด"
                  >
                    <input
                      type="number"
                      name="pmGraceDays"
                      defaultValue={s.pmGraceDays}
                      min={0}
                      max={365}
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label="ใบงานเกินได้กี่วัน"
                    hint="เลยกำหนดเกินกี่วันถึงถือว่าปล่อยปละละเลย — 0 = หักทันทีที่เลยกำหนด"
                  >
                    <input
                      type="number"
                      name="workOrderGraceDays"
                      defaultValue={s.workOrderGraceDays}
                      min={0}
                      max={365}
                      required
                      className={inputClass}
                    />
                  </Field>
                </>
              )}
              {group.keys.map((key) => (
                <Field
                  key={key}
                  label={PERFORMANCE_CATEGORIES[key]}
                  hint={`ค่าเริ่มต้น ${DEFAULT_RULE_POINTS[key]}`}
                >
                  <input
                    type="number"
                    name={`rule_${key}`}
                    defaultValue={s.rulePoints[key]}
                    min={-100}
                    max={100}
                    className={inputClass}
                  />
                </Field>
              ))}
            </div>
          </SectionCard>
        ))}

        <Card className="p-4">
          <p className="mb-3 text-xs text-(--ink-soft)">
            ค่าติดลบ = หักคะแนน · ค่าบวก = ได้คะแนนเพิ่ม ·
            การแก้เกณฑ์ไม่ย้อนไปแก้เหตุการณ์ที่บันทึกไปแล้ว
            มีผลกับเหตุการณ์ที่เกิดหลังจากนี้
          </p>
          <Button type="submit" className="w-full sm:w-40">
            บันทึกเกณฑ์
          </Button>
        </Card>
      </form>
    </AppScaffold>
  );
}
