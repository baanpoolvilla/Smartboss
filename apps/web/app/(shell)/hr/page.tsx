import Link from "next/link";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { NotifCountBadge } from "@/modules/notifications/notif-count-badge";
import { renderTodayTab } from "./home-today";
import { renderCorrectionsTab } from "./home-corrections";
import { renderCalendarTab } from "./home-calendar";
import { renderOvertimeTab } from "./home-overtime";

/** notifTypes = แจ้งเตือนที่ลิงก์มาแท็บนี้ (ดู derive.ts) — ตัวเลขแดงบนแท็บบอกว่าเลข
 * บนเมนู "หน้าหลัก" มาจากแท็บไหน ("เปิดมาไม่รู้เลยมาจากอันไหน") */
const TABS = [
  { id: "today", label: "วันนี้", notifTypes: ["hr_leave_decided", "hr_attendance_correction_decided", "hr_overtime_decided"] },
  { id: "corrections", label: "คำขอแก้เวลา", notifTypes: ["hr_attendance_correction_submitted"] },
  { id: "overtime", label: "OT รออนุมัติ", notifTypes: ["hr_overtime_pending"] },
  { id: "calendar", label: "ปฏิทินทีม", notifTypes: ["hr_leave_submitted"] },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * แท็บที่ต้องมีสิทธิ์จัดการพนักงาน — อนุมัติ OT กระทบเงินเดือนตรง ๆ
 * "คำขอแก้เวลา" เปิดให้ทุกคน: คนไม่มีสิทธิ์จัดการเห็น/ยื่นได้เฉพาะของตัวเอง
 * ไม่มีปุ่มอนุมัติ (ดู renderCorrectionsTab)
 */
const MANAGE_TABS: readonly TabId[] = ["overtime"];

const TAB_TITLE: Record<TabId, string> = {
  today: "การลงเวลา",
  corrections: "คำขอแก้เวลา",
  overtime: "OT รออนุมัติ",
  calendar: "ปฏิทินทีม",
};

/**
 * หน้าหลักของโมดูลบุคคล — รวม 3 อย่างที่เคยเป็นเมนูแยกกัน (การลงเวลา/
 * ลงเวลาแบบ manual/ปฏิทินวันหยุด) เป็น tab เดียวกันตาม IA ใหม่ (ยุบเมนู 15 → 5)
 *
 * "OT รออนุมัติ" ต้องมี HR_PERMS.employeeManage ถึงเข้าได้ (กระทบเงินเดือนตรง ๆ)
 * ส่วนแท็บอื่นเปิดด้วย HR_PERMS.access เหมือนกัน — เพราะ HrPage เช็คสิทธิ์ได้แค่
 * ระดับหน้า ไม่ใช่ระดับ tab จึงต้องเช็คสิทธิ์ของ tab เองตรงนี้ แล้วเด้งกลับไป
 * "วันนี้" เงียบ ๆ ถ้าไม่มีสิทธิ์ (ไม่ใช่ 403 เพราะ tab อื่นในหน้าเดียวกันเข้าได้อยู่แล้ว)
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
  // ที่กดแล้วได้ 403 ให้คนงง — และคุมว่าแท็บ "คำขอแก้เวลา" เป็นคิวอนุมัติของทุกคน
  // หรือแค่คำขอของตัวเอง
  const canManage = hasPermission(session, HR_PERMS.employeeManage);

  const sp = await searchParams;
  const requested = TABS.some((t) => t.id === sp.tab) ? (sp.tab as TabId) : "today";
  const tab: TabId = MANAGE_TABS.includes(requested) && !canManage ? "today" : requested;

  return (
    <HrPage
      title={TAB_TITLE[tab]}
      permission={HR_PERMS.access}
      load={async () => {
        const tabBar = (
          <div className="mb-4 flex gap-1 border-b border-(--line)">
            {TABS.filter((t) => !MANAGE_TABS.includes(t.id) || canManage).map((t) => (
              <Link
                key={t.id}
                href={t.id === "today" ? "/hr" : `/hr?tab=${t.id}`}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
                  tab === t.id
                    ? "border-(--app-strong,var(--ink)) text-(--ink)"
                    : "border-transparent text-(--ink-soft) hover:text-(--ink)"
                }`}
              >
                {t.label}
                <NotifCountBadge
                  categories={["hr_leave", "hr_attendance"]}
                  types={[...t.notifTypes]}
                  className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white"
                />
              </Link>
            ))}
          </div>
        );

        let body: React.ReactNode;
        if (tab === "corrections") {
          body = await renderCorrectionsTab(canManage);
        } else if (tab === "overtime") {
          body = await renderOvertimeTab();
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
