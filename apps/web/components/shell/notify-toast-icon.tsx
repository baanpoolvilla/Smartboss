import { Bell, MessageCircle } from "lucide-react";
import { toast } from "sonner";

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

// ─── กล่องเด้งแจ้งเตือนที่กดได้ทั้งกล่อง ───
// เดิมกดได้แค่ปุ่ม "เปิด" เล็ก ๆ — กดที่ตัวกล่อง/ข้อความไม่เกิดอะไร แล้วกล่องหายไปเอง
// ("กดอ่านแล้ววาปหายไปเลย ไม่มาที่หน้านี้") ตอนนี้กดตรงไหนของกล่องก็เปิดปลายทาง
let toastSeq = 0;
const toastOpeners = new Map<string, () => void>();
let toastClickInstalled = false;

function installToastClick() {
  if (toastClickInstalled || typeof document === "undefined") return;
  toastClickInstalled = true;
  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    const li = target?.closest?.("[data-sonner-toast]");
    if (!li || target?.closest("button")) return; // ปุ่ม "เปิด" / ปุ่มปิด ทำงานของมันเอง
    const key = Array.from(li.classList).find((c) => c.startsWith("sb-notify-"));
    const open = key ? toastOpeners.get(key) : undefined;
    if (open) open();
  });
}

export function showNotifyToast(input: { title: string; body?: string; kind: "notify" | "chat"; duration?: number; onOpen: () => void }) {
  installToastClick();
  const key = `sb-notify-${++toastSeq}`;
  const forget = () => toastOpeners.delete(key);
  const id = toast(input.title, {
    description: input.body || undefined,
    icon: <NotifyToastIcon kind={input.kind} />,
    classNames: { ...NOTIFY_TOAST_CLASSES, toast: `${key} cursor-pointer` },
    duration: input.duration ?? 8000,
    action: {
      label: "เปิด",
      onClick: () => {
        forget();
        input.onOpen();
      },
    },
    onDismiss: forget,
    onAutoClose: forget,
  });
  toastOpeners.set(key, () => {
    forget();
    toast.dismiss(id);
    input.onOpen();
  });
}
