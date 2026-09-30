import { cn } from "@smartboss/ui/cn";

/**
 * เส้น "มีข้อความใหม่ตั้งแต่ตรงนี้" แบบ Discord — เส้นแดงบาง + ป้ายแดง NEW ชิดขวา
 * ใช้ทั้งห้องแชท (modules/chat/components/message-list.tsx) และห้องรายงาน (report-new-divider.tsx)
 * ให้หน้าตาเหมือนกัน ตำแหน่งตรึงไว้ที่ข้อความแรกที่ยังไม่อ่านตอนเปิดห้อง ไม่เลื่อนตามตอนอ่าน
 */
export function NewDivider({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center", className)} role="separator" aria-label="ข้อความใหม่">
      <div className="h-px flex-1 bg-[#dc2626]" />
      <span className="shrink-0 rounded-[4px] bg-[#dc2626] px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide text-white">New</span>
    </div>
  );
}
