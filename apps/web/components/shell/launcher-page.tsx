import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * โครงหน้าสำหรับหน้าที่ไม่ใช่โมดูล (บัญชีของฉัน ฯลฯ) — แถบบน SmartBoss ของ shell
 * วาดให้อยู่แล้ว ใช้ AppScaffold ซ้อนเข้าไปจะได้แถบหัวสองชั้น ("เอาที่วงออก ไม่สวย")
 * วางแบบเดียวกับหน้าโฮม / Sale & Marketing: ลิงก์ย้อนกลับเล็ก ๆ + หัวข้อกลางหน้า
 */
export function LauncherPage({
  title,
  width = "max-w-3xl",
  backHref = "/",
  backLabel = "หน้าหลัก",
  children,
}: {
  title: string;
  width?: string;
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto w-full ${width}`}>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-(--ink-soft) transition-colors hover:bg-(--bg) hover:text-(--ink)"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>
      <h1 className="mt-3 mb-5 text-center text-2xl font-semibold text-(--ink)">{title}</h1>
      {children}
    </div>
  );
}
