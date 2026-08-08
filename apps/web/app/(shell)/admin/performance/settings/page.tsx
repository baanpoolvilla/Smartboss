import { redirect } from "next/navigation";
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

/** จัดกลุ่มตามโมดูลต้นทาง ให้หาเจอง่ายกว่าเรียงยาวเป็นพืด */
const GROUPS: { title: string; hint: string; keys: PerformanceCategory[] }[] = [
  {
    title: "งานและรายงาน",
    hint: "จากโมดูลรายงานและงาน",
    keys: ["task_late", "task_manual_dock", "report_missed", "report_late"],
  },
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
          description="เท่าไหร่ถึงเริ่มถือว่าผิด — ต่ำกว่านี้ไม่ถูกบันทึกเลย"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="สายเกินกี่นาทีถึงนับ" hint="ต่ำกว่านี้ถือว่าอยู่ในวิสัยปกติ">
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
            <Field label="ขาดงานเกินกี่นาทีถึงนับ" hint="240 = ครึ่งวัน">
              <input
                type="number"
                name="absenceThresholdMinutes"
                defaultValue={s.absenceThresholdMinutes}
                min={0}
                max={1440}
                required
                className={inputClass}
              />
            </Field>
            <Field
              label="ผ่อนผัน PM กี่วัน"
              hint="เลยกำหนดเกินกี่วันถึงถือว่าปล่อยปละละเลย"
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
              label="ย้อนดูผลลงเวลากี่วัน"
              hint="แต่ละรอบที่ระบบตรวจ จะมองย้อนหลังเท่านี้"
            >
              <input
                type="number"
                name="attendanceLookbackDays"
                defaultValue={s.attendanceLookbackDays}
                min={1}
                max={365}
                required
                className={inputClass}
              />
            </Field>
          </div>
        </SectionCard>

        {GROUPS.map((group) => (
          <SectionCard key={group.title} title={group.title} description={group.hint}>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.keys.map((key) => (
                <Field
                  key={key}
                  label={PERFORMANCE_CATEGORIES[key]}
                  hint={
                    key === "task_manual_dock"
                      ? "หัวหน้ากรอกคะแนนเอง ค่านี้ไม่ถูกใช้"
                      : `ค่าเริ่มต้น ${DEFAULT_RULE_POINTS[key]}`
                  }
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
