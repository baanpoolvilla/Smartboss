import { Button } from "@smartboss/ui/components/button";
import {
  composeDisplayName,
  DEFAULT_DISPLAY_NAME_FORMAT,
  DISPLAY_NAME_FORMAT_LABELS,
  DISPLAY_NAME_FORMATS,
  isDisplayNameFormat,
  type DisplayNameFormat,
} from "@workforce/domain";
import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, wfTry, type Company, type Paged, type Person } from "@/modules/hr/lib/api";
import { NotProvisioned, SectionCard } from "@/modules/hr/components/ui";
import { setDisplayNameFormatAction } from "../../actions";

/**
 * ตัวอย่างที่ใช้ตอนไม่มีพนักงานสักคนให้ยกมาโชว์ — ชื่อสมมติ ไม่ใช่ค่าตั้งต้นของระบบ
 */
const SAMPLE = {
  firstName: "สมชาย",
  lastName: "ใจดี",
  preferredName: "ชาย",
};

/**
 * รูปแบบชื่อที่แสดงทั้งระบบ — ตั้งครั้งเดียว มีผลกับทุกคนทุกหน้า
 *
 * ตัวอย่างในหน้านี้คำนวณด้วย composeDisplayName ตัวเดียวกับที่ workforce ใช้จริง
 * (ไม่เขียนสูตรซ้ำ) — ที่เห็นในตัวอย่างคือสิ่งที่จะได้จริงหลังกดบันทึก
 */
export default async function DisplayNameSettingsPage() {
  return (
    <HrPage
      title="รูปแบบชื่อที่แสดง"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const companies = await wfFetch<Paged<Company>>("/companies");
        const company = companies.items[0];
        if (company === undefined) {
          return <NotProvisioned what="ตั้งรูปแบบชื่อ" />;
        }

        const current: DisplayNameFormat = isDisplayNameFormat(company.display_name_format)
          ? company.display_name_format
          : DEFAULT_DISPLAY_NAME_FORMAT;

        /*
         * ยกพนักงานจริงคนแรกที่ "มีชื่อเล่น" มาเป็นตัวอย่าง — ตัวอย่างที่ใช้คนไม่มี
         * ชื่อเล่นจะได้ผลเหมือนกันทั้งสามแบบ แล้วคนเลือกจะมองไม่ออกว่าต่างกันยังไง
         */
        const people = await wfTry<Paged<Person>>("/people?limit=50");
        const sample =
          people?.items.find((p) => p.preferred_name.trim() !== "" && p.first_name.trim() !== "") ??
          null;
        const parts =
          sample === null
            ? SAMPLE
            : {
                firstName: sample.first_name,
                lastName: sample.last_name,
                preferredName: sample.preferred_name,
              };

        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <SettingsSubnav active="/hr/settings/names" />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <SectionCard
                title="ชื่อที่ทุกคนเห็น"
                description="ค่านี้เปลี่ยนชื่อที่แสดงของพนักงานทุกคนพร้อมกัน ทั้งระบบบุคคล การลงเวลา แชท บอร์ดงาน และรายงาน"
              >
                <form action={setDisplayNameFormatAction} className="flex flex-col gap-3">
                  <input type="hidden" name="company_id" value={company.id} />

                  <div className="flex flex-col gap-2">
                    {DISPLAY_NAME_FORMATS.map((format) => (
                      <label
                        key={format}
                        className="flex cursor-pointer items-center gap-3 rounded-(--radius) border border-(--line) px-3 py-2.5 hover:bg-(--bg-soft)"
                      >
                        <input
                          type="radio"
                          name="display_name_format"
                          value={format}
                          defaultChecked={format === current}
                          className="h-4 w-4 shrink-0 accent-(--app,var(--brand-green))"
                        />
                        <span className="min-w-0 flex-1 text-sm text-(--ink-soft)">
                          {DISPLAY_NAME_FORMAT_LABELS[format]}
                        </span>
                        <span className="shrink-0 text-sm font-medium text-(--ink)">
                          {composeDisplayName(parts, format)}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div>
                    <Button type="submit">บันทึกรูปแบบชื่อ</Button>
                  </div>
                </form>

                <p className="mt-3 text-xs text-(--ink-soft)">
                  ตัวอย่างด้านขวาคิดจาก
                  {sample === null
                    ? " ชื่อสมมติ (ยังไม่มีพนักงานที่กรอกชื่อเล่นไว้)"
                    : ` ${parts.firstName} ${parts.lastName} ที่มีชื่อเล่น “${parts.preferredName}”`}
                </p>
              </SectionCard>

              <SectionCard title="สิ่งที่เกิดขึ้นตอนกดบันทึก">
                <ul className="ml-4 list-disc space-y-1 text-sm text-(--ink-soft)">
                  <li>ชื่อในทะเบียนพนักงานและทุกหน้าของระบบบุคคลเปลี่ยนทันที</li>
                  <li>
                    ชื่อบัญชีผู้ใช้ที่แชท บอร์ดงาน และรายงานใช้ ถูกเขียนตามให้ด้วย โดย
                    จับคู่จาก<strong className="text-(--ink)">อีเมล</strong>
                  </li>
                  <li>
                    คนที่ไม่มีอีเมลในทะเบียนพนักงาน หรือมีบัญชีแต่ไม่มีทะเบียน (เช่นแอดมินระบบ)
                    ชื่อจะไม่ถูกแตะ — ระบบไม่มีชื่อแยกช่องของคนนั้นให้ประกอบ
                  </li>
                  <li>
                    ไม่มีชื่อเล่น → แบบที่มีชื่อเล่นจะตกมาใช้ชื่อจริงเฉย ๆ ไม่ขึ้นวงเล็บว่างหรือขีดนำหน้า
                  </li>
                </ul>
              </SectionCard>
            </div>
          </div>
        );
      }}
    />
  );
}
