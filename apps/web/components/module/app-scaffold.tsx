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
  leading,
  actions,
  fab,
  width = "max-w-4xl",
  fill = false,
  fillMaxWidth = false,
  children,
}: {
  title: string;
  /** ปุ่มย้อนกลับซ้ายสุดของ AppBar (หน้ารายละเอียด/ฟอร์ม) */
  backHref?: string;
  /**
   * ตัวควบคุมกำหนดเองซ้ายสุดของ AppBar แทน backHref — ให้หน้าลูก (เช่น
   * ตัวสลับห้องของหน้ารายงาน) วางปุ่มของตัวเองไว้บนแถบเดียวกับชื่อหน้าได้
   * โดยไม่ต้องเพิ่ม prop ใหม่ให้ทุกหน้าที่ไม่ได้ใช้. ชนะ backHref เมื่อส่งมาทั้งคู่
   * (ยังไม่มีหน้าไหนต้องการทั้งสองพร้อมกันจริง ๆ)
   */
  leading?: React.ReactNode;
  /** ปุ่มเพิ่มเติมของหน้านั้น วางก่อนกระดิ่ง */
  actions?: React.ReactNode;
  fab?: React.ReactNode;
  /** ความกว้างสูงสุดของเนื้อหา */
  width?: string;
  /** true = เนื้อหาเต็มพื้นที่และจัดการ scroll เอง (กระดาน Kanban) */
  fill?: boolean;
  /**
   * true = จำกัด `width` เดียวกับหน้าอื่น ๆ ของโมดูลแม้อยู่โหมด fill (แค่ยังคุม
   * scroll เองอยู่) — ไว้ให้หน้าที่ปกติกว้างเต็มจอ (เช่น บอร์ด Kanban) เว้นขอบ
   * ซ้าย/ขวาเท่ากับหน้าอื่นในโมดูลเดียวกันบนจอกว้างเกิน `width`, แทนที่จะกาง
   * เต็มจอไม่มีขอบ ค่าเริ่มต้น false รักษาพฤติกรรมเดิม (เต็มจอไม่มีขอบ) ของ
   * หน้าที่ใช้ fill โดยไม่ได้ตั้งใจเทียบขอบกับหน้าอื่น
   */
  fillMaxWidth?: boolean;
  children: React.ReactNode;
}) {
  const header = (
    <header className="shrink-0 border-b border-(--line) bg-(--bg)">
      <div className="flex h-[60px] items-center gap-1 px-2 sm:px-3">
        <div className="flex min-w-[44px] flex-1 items-center justify-start sm:min-w-[110px]">
          {leading ??
            (backHref && (
              <Link
                href={backHref}
                className="rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
                aria-label="ย้อนกลับ"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
            ))}
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
  );

  if (fill) {
    // Self-contained on mobile — `fixed inset-0` sizes this to the real
    // viewport regardless of any ancestor's height, instead of relying on
    // Shell's own wrapper being height-bounded (it only is at `lg:` —
    // changing that would ripple into every other page in the app, most of
    // which have never been checked for their own mobile scroll chain).
    // Without this, a fill page (Kanban board, รายงาน feed) had no bounded
    // height to hand its own internal `overflow-y-auto` panels below `lg:`,
    // so the *whole page* — AppBar and bottom nav included — scrolled as one
    // long document instead of just the content in between
    // ("มีเยอะๆเลื่อนหาตายเลย" / "ล็อคอยู่หน้านั้นแต่แบบสกอขึ้นลงได้").
    // `lg:static` hands control straight back to Shell's own `lg:h-dvh` at
    // desktop width, unchanged from before.
    return (
      <div className="fixed inset-0 z-0 flex flex-col pb-[68px] lg:static lg:z-auto lg:min-h-0 lg:flex-1 lg:pb-0">
        {header}
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className={fillMaxWidth ? `mx-auto h-full w-full ${width} px-4 py-4 sm:px-6 sm:py-5` : "h-full px-4 py-4 sm:px-6 sm:py-5"}>
            {children}
          </div>
        </div>
        {fab}
      </div>
    );
  }

  return (
    <>
      {/* sticky, not shrink-0 — this branch stays exactly as it always has
          (natural whole-page scroll below `lg:`, own scroll region above
          it), untouched by the `fill` fix above. */}
      <div className="sticky top-0 z-30">{header}</div>

      <div className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div className={`mx-auto w-full ${width} px-4 py-4 sm:px-6 sm:py-5`}>{children}</div>
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
