import Link from "next/link";
import { Avatar } from "@smartboss/ui/components/avatar";

/**
 * PageHeader — ชื่อหน้า + คำอธิบายบรรทัดเดียว + ปุ่ม action หลัก
 *
 * ไม่ได้เข้าไปแทนที่ระบบหัวข้อของ HrPage/AppScaffold (ซึ่งโมดูลอื่นใช้ร่วมด้วย)
 * — สร้างแยกไว้สำหรับเนื้อหาในหน้าที่ต้องมีหัวข้อย่อยของตัวเอง (เช่นในแต่ละ
 * tab ของหน้าที่จะยุบเมนูเข้าด้วยกันในเฟสถัดไป) เพื่อไม่ต้องแตะ AppScaffold
 * ซึ่งกระทบทุกโมดูล ไม่ใช่แค่ HR
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-(--ink)">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-(--ink-soft)">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * แถวแสดงตัวตนพนักงาน — avatar + ชื่อจริง/นามสกุล + (ชื่อเล่น) จาง + รหัส
 * รูปแบบเดียวที่ควรใช้ซ้ำได้ทุกตาราง/รายการ แทนที่แต่ละหน้าจะประกอบเอง
 * คนละแบบ (ดูปัญหาข้อ 5.4 ของสเปค — ชื่อคนแสดงไม่ตรงกันทั้งแอป)
 */
export function PersonRow({
  fullName,
  nickname,
  employeeCode,
}: {
  fullName: string;
  nickname?: string | null;
  employeeCode?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={fullName} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-(--ink)">
          {fullName}
          {nickname && (
            <span className="ml-1 font-normal text-(--ink-soft)">
              ({nickname})
            </span>
          )}
        </p>
        {employeeCode && (
          <p className="truncate font-mono text-[11px] text-(--ink-soft)">
            {employeeCode}
          </p>
        )}
      </div>
    </div>
  );
}

const SETTINGS_NAV: { href: string; label: string }[] = [
  { href: "/hr/settings", label: "กะและเวลาทำงาน" },
  { href: "/hr/settings/attendance", label: "การลงเวลา" },
  { href: "/hr/settings/devices", label: "อุปกรณ์" },
  { href: "/hr/settings/holidays", label: "วันหยุดบริษัท" },
  { href: "/hr/settings/leave-types", label: "ประเภทการลา" },
  // เกณฑ์คะแนน/เกรดเป็นของระบบผลงานกลาง (core.performance_settings) ไม่ใช่ของ
  // โมดูลบุคคล — ลิงก์ไปหน้าเดียวที่มีอยู่แล้วแทนที่จะสร้างซ้ำเป็นสองแหล่งความจริง
  { href: "/admin/performance/settings", label: "เกณฑ์คะแนน" },
  { href: "/hr/settings/statutory", label: "ค่าจ้างและกฎหมาย" },
  { href: "/hr/settings/audit", label: "ประวัติการใช้งาน" },
];

/**
 * sub-nav ด้านซ้ายของหน้าตั้งค่า — แทนการ์ดลิงก์ไปหน้าตั้งค่าอื่นที่เคยซ้อนกันอยู่
 * (nav ซ้อน nav) ทุกหน้าย่อยของ /hr/settings ใช้ตัวเดียวกันนี้
 */
export function SettingsSubnav({ active }: { active: string }) {
  return (
    <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto sm:w-52 sm:flex-col sm:overflow-visible">
      {SETTINGS_NAV.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 rounded-(--radius) px-3 py-2 text-sm whitespace-nowrap ${
              isActive
                ? "bg-(--app-pale,var(--bg-soft)) font-semibold text-(--app-strong,var(--ink))"
                : "text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
