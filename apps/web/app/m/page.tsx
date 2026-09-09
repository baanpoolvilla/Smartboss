import { lineLoginConfigured } from "@/lib/line";
import { MiniApp } from "./mini-app";

/**
 * หน้าแรกของ Mini App — "วันนี้"
 *
 * เป็น server component บาง ๆ ที่ทำแค่ส่งค่า config ลงไปให้ฝั่ง client
 * เพราะขั้นตอนตัวตนทั้งหมดต้องเริ่มจาก `liff.init()` ซึ่งรันได้เฉพาะบนเบราว์เซอร์
 *
 * `dynamic = "force-dynamic"` เพราะค่า env อ่านตอน request — ถ้าปล่อยให้ Next
 * prerender ไว้ตอน build ค่าที่ยังไม่ได้ตั้งตอน build จะถูกอบติดไปกับหน้า
 * แล้วต่อให้เติม env ทีหลังก็ไม่มีผลจนกว่าจะ build ใหม่
 */
export const dynamic = "force-dynamic";

export default function MiniAppPage() {
  return (
    <MiniApp
      liffId={process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? ""}
      lineReady={lineLoginConfigured()}
    />
  );
}
