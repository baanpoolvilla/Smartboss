import Link from "next/link";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { renderTodayTab } from "./home-today";
import { renderCorrectionsTab } from "./home-corrections";
import { renderCalendarTab } from "./home-calendar";

const TABS = [
  { id: "today", label: "วันนี้" },
  { id: "corrections", label: "คำขอแก้เวลา" },
  { id: "calendar", label: "ปฏิทินทีม" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_TITLE: Record<TabId, string> = {
  today: "การลงเวลา",
  corrections: "คำขอแก้เวลา",
  calendar: "ปฏิทินทีม",
};

/**
 * หน้าหลักของโมดูลบุคคล — รวม 3 อย่างที่เคยเป็นเมนูแยกกัน (การลงเวลา/
 * ลงเวลาแบบ manual/ปฏิทินวันหยุด) เป็น tab เดียวกันตาม IA ใหม่ (ยุบเมนู 15 → 5)
 *
 * "คำขอแก้เวลา" เดิมต้องมี HR_PERMS.employeeManage ถึงเข้าได้ (แก้เวลากระทบ
 * เงินเดือนตรง ๆ) ส่วน "วันนี้"/"ปฏิทินทีม" เปิดด้วย HR_PERMS.access เหมือนกัน
 * — เพราะ HrPage เช็คสิทธิ์ได้แค่ระดับหน้า ไม่ใช่ระดับ tab จึงต้องเช็คสิทธิ์
 * ของ tab "คำขอแก้เวลา" เองตรงนี้ แล้วเด้งกลับไป "วันนี้" เงียบ ๆ ถ้าไม่มีสิทธิ์
 * (ไม่ใช่ 403 เพราะ tab อื่นในหน้าเดียวกันเข้าได้อยู่แล้ว)
 */
export default async function HrOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string; month?: string }>;
}) {
  const session = await requireOrg();
  // ปุ่ม export เรียก /attendance-results ซึ่งต้องมีสิทธิ์อ่านผลลงเวลาของทุกคน
  // ฝั่ง workforce — hr.employee.manage คือสิทธิ์ที่ถูกแปลงเป็นบทบาทนั้นตอน sync
  // (ดู mapSmartbossRoles) ⇒ ใช้ตัวเดียวกันคุมว่าจะโชว์การ์ดไหน จะได้ไม่มีปุ่ม
  // ที่กดแล้วได้ 403 ให้คนงง — และคุมว่าเข้าแท็บ "คำขอแก้เวลา" ได้ไหมด้วย
  const canManage = hasPermission(session, HR_PERMS.employeeManage);

  const sp = await searchParams;
  const requested = TABS.some((t) => t.id === sp.tab) ? (sp.tab as TabId) : "today";
  const tab: TabId = requested === "corrections" && !canManage ? "today" : requested;

  return (
    <HrPage
      title={TAB_TITLE[tab]}
      permission={HR_PERMS.access}
      load={async () => {
        const tabBar = (
          <div className="mb-4 flex gap-1 border-b border-(--line)">
            {TABS.filter((t) => t.id !== "corrections" || canManage).map((t) => (
              <Link
                key={t.id}
                href={t.id === "today" ? "/hr" : `/hr?tab=${t.id}`}
                className={`border-b-2 px-3 py-2 text-sm font-medium ${
                  tab === t.id
                    ? "border-(--app-strong,var(--ink)) text-(--ink)"
                    : "border-transparent text-(--ink-soft) hover:text-(--ink)"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        );

        let body: React.ReactNode;
        if (tab === "corrections") {
          body = await renderCorrectionsTab();
        } else if (tab === "calendar") {
          body = await renderCalendarTab(sp.month);
        } else {
          body = await renderTodayTab(sp.date, canManage);
        }

        return (
          <>
            {tabBar}
            {body}
          </>
        );
      }}
    />
  );
}
