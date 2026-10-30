import Link from "next/link";

const SIDEBAR_REPLACES_TABS = true;

/** แท็บของหน้าจัดการเงินเดือน (CEO + คนที่ CEO เลือก) */
export function SalaryTabs({ active }: { active: "runs" | "employees" | "commission" | "settings" | "guide" | "my" }) {
  // การเงินพนักงาน (30/10/2569): เมนูซ้ายแบ่งกลุ่มแทนแท็บด้านบนแล้ว — แท็บซ้ำกับเมนู ไม่แสดง
  if (SIDEBAR_REPLACES_TABS) return null;
  const tabs = [
    { id: "runs", label: "รายการเงินเดือน", href: "/salary" },
    { id: "employees", label: "รายชื่อพนักงาน", href: "/salary/employees" },
    { id: "commission", label: "ค่าคอม", href: "/salary/commission" },
    { id: "settings", label: "ตั้งค่า", href: "/salary/settings" },
    { id: "guide", label: "คู่มือ", href: "/salary/guide" },
    { id: "my", label: "สลิปของฉัน", href: "/salary/my" },
  ] as const;
  return (
    <nav aria-label="เงินเดือน" className="relative flex gap-1 overflow-x-auto border-b border-(--line)">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${active === t.id ? "border-(--brand-navy,#1b2537) text-(--ink)" : "border-transparent text-(--ink-soft) hover:text-(--ink)"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
