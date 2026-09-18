import Link from "next/link";

/**
 * สลับไปมาระหว่าง "โปรไฟล์" (ข้อมูลบัญชี/รหัสผ่าน — /account เดิม) กับ
 * "งานของฉัน" (ห้องที่ต้องส่งรายงาน + สรุปงาน — /account/work ใหม่) แต่ละหน้า
 * ส่ง `active` ของตัวเองมาตรงๆ (ทั้งคู่เป็น Server Component คนละ route กัน
 * ไม่ใช่ client tab ที่สลับ state — เหมือนแพตเทิร์น SettingsSubnav ของ HR)
 */
const TABS = [
  { href: "/account", label: "โปรไฟล์" },
  { href: "/account/work", label: "งานของฉัน" },
] as const;

export function AccountTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-(--line)">
      {TABS.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              isActive
                ? "border-(--app-strong,var(--ink)) font-semibold text-(--app-strong,var(--ink))"
                : "border-transparent text-(--ink-soft) hover:text-(--ink)"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
