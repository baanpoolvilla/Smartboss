import { Bell, MessageCircle } from "lucide-react";

/** ไอคอนวงกลมหน้ากล่องเด้งแจ้งเตือน — กระดิ่ง (งาน/HR/งานซ่อม/รายงาน) หรือแชท ให้รู้ว่ามาจากไหนแวบเดียว */
export function NotifyToastIcon({ kind }: { kind: "notify" | "chat" }) {
  const Icon = kind === "chat" ? MessageCircle : Bell;
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0fdf4] text-[#16a34a]">
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** ช่องไอคอนของ sonner ตั้งไว้ 16px — ขยายให้พอกับวงกลมด้านบน (เฉพาะกล่องแจ้งเตือน ไม่กระทบ toast อื่น) */
export const NOTIFY_TOAST_CLASSES = { icon: "size-9! mr-1.5! self-start!" } as const;
