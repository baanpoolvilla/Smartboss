/**
 * โครงหน้าจอมาตรฐานของทุกโมดูล (maintenance / hr / admin)
 * ต้นแบบคือ Scaffold(appBar:, body:, floatingActionButton:) ของ ChangYai
 * AppBar: ขาว ชื่อเรื่องกลางจอ เส้นคั่นล่าง ปุ่มกระดิ่ง + ออกจากระบบชิดขวา
 *
 * จอใหญ่: body เป็นตัวเลื่อนเอง (AppBar ค้างอยู่กับที่) เหมือน Scaffold ของ Flutter
 * มือถือ: เลื่อนทั้งหน้า AppBar ใช้ sticky
 */
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { AppBarActions } from "./app-bar-actions";

export function AppScaffold({
  title,
  backHref,
  actions,
  fab,
  width = "max-w-4xl",
  fill = false,
  children,
}: {
  title: string;
  /** ปุ่มย้อนกลับซ้ายสุดของ AppBar (หน้ารายละเอียด/ฟอร์ม) */
  backHref?: string;
  /** ปุ่มเพิ่มเติมของหน้านั้น วางก่อนกระดิ่ง */
  actions?: React.ReactNode;
  fab?: React.ReactNode;
  /** ความกว้างสูงสุดของเนื้อหา */
  width?: string;
  /** true = เนื้อหาเต็มพื้นที่และจัดการ scroll เอง (กระดาน Kanban) */
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="sticky top-0 z-30 shrink-0 border-b border-(--line) bg-(--bg)">
        <div className="flex h-[60px] items-center gap-1 px-2 sm:px-3">
          <div className="flex min-w-[44px] flex-1 items-center justify-start sm:min-w-[110px]">
            {backHref && (
              <Link
                href={backHref}
                className="rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
                aria-label="ย้อนกลับ"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
            )}
          </div>

          <h1 className="truncate px-1 text-center text-lg font-bold text-(--ink) sm:text-xl">
            {title}
          </h1>

          <div className="flex min-w-[44px] flex-1 items-center justify-end gap-0.5 sm:min-w-[110px]">
            {actions}
            <AppBarActions />
          </div>
        </div>
      </header>

      <div
        className={
          fill
            ? "min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-hidden"
            : "min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        }
      >
        {fill ? (
          <div className="lg:h-full px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        ) : (
          <div className={`mx-auto w-full ${width} px-4 py-4 sm:px-6 sm:py-5`}>{children}</div>
        )}
      </div>

      {fab}
    </>
  );
}

/** ปุ่มไอคอนบน AppBar (IconButton ของ Flutter) */
export function AppBarLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
    >
      {children}
    </Link>
  );
}

/** FloatingActionButton.extended — teal 500 มุมขวาล่าง ลอยเหนือ bottom nav บนมือถือ */
export function Fab({
  href,
  label,
  icon,
  color,
}: {
  href: string;
  /** ไม่ใส่ = FAB วงกลมไอคอนอย่างเดียว (FloatingActionButton ธรรมดา) */
  label?: string;
  icon?: React.ReactNode;
  color?: string;
}) {
  const base =
    "fixed bottom-[84px] right-4 z-40 inline-flex items-center justify-center text-white shadow-[0_4px_14px_rgba(13,148,136,0.4)] transition-transform hover:brightness-105 active:scale-95 lg:bottom-6 lg:right-6";

  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={
        label
          ? `${base} h-14 gap-2 rounded-2xl px-5 text-[15px] font-medium`
          : `${base} h-14 w-14 rounded-2xl`
      }
      style={{ backgroundColor: color ?? "var(--app-accent)" }}
    >
      {icon ?? <Plus className="h-5 w-5" />}
      {label}
    </Link>
  );
}
