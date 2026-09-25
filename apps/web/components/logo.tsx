import { cn } from "@smartboss/ui/cn";

/**
 * โลโก้ SmartBoss — ไฟล์จริงของแบรนด์ (public/logo.png, ตัดจากไฟล์โลโก้ต้นฉบับ พื้นใส ความละเอียด 3 เท่า)
 * ไม่ใช่ตัวหนังสือพิมพ์เองอีกแล้ว ("แก้ตรงนี้ด้วยเอาเป็นไฟล์นี้") — สีเขียว/กรมท่าตายตัวในรูป
 * จึงไม่โดนสีของแต่ละโมดูลทับเหมือนตอนเป็นตัวหนังสือ
 * ไอคอนแอป/แท็บเบราว์เซอร์/Taskbar ใช้ตัว "o" หน้ายิ้มของโลโก้ (public/icon-v3*.png) — คำเต็มเล็กเกินอ่านไม่ออกที่ 16–32px
 */
export function Logo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const heights = {
    sm: "h-5",
    md: "h-6",
    lg: "h-9",
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="SmartBoss"
      width={652}
      height={96}
      draggable={false}
      className={cn("w-auto select-none", heights[size], className)}
    />
  );
}
