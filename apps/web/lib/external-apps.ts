import { MessageCircle, Send, type LucideIcon } from "lucide-react";

/**
 * เว็บภายนอกที่บริษัททำไว้เอง (ไม่ได้อยู่ใน SmartBoss) — รวมลิงก์ไว้ให้กดเปิด
 * จากหน้าโฮมที่เดียว ("อยากให้มารวมเปิดได้จากที่สมาร์ทบอส") ไม่ได้ฝังหรือ
 * login แทน แค่พาไปยังเว็บนั้น ๆ ในแท็บใหม่
 *
 * เพิ่ม/แก้ลิงก์ที่นี่แล้ว deploy — หน้า /sales-marketing อ่านจากรายการนี้
 */
export interface ExternalApp {
  name: string;
  description: string;
  url: string;
  icon: LucideIcon;
  /** สีไอคอน/พื้นไอคอน — ใช้ token เดียวกับไอคอนโมดูลในหน้าโฮม */
  color: string;
  colorBg: string;
}

export const SALES_MARKETING_APPS: ExternalApp[] = [
  {
    name: "Multi Post System",
    description: "โพสต์ลงหลายช่องทางพร้อมกัน",
    url: "https://multipost-nu.vercel.app/",
    icon: Send,
    color: "var(--mod-marketing)",
    colorBg: "var(--mod-marketing-bg)",
  },
  {
    name: "Baanpool-Chat",
    description: "แชทลูกค้า Baanpool",
    url: "https://baanpoolchat.vercel.app/login",
    icon: MessageCircle,
    color: "var(--mod-sale)",
    colorBg: "var(--mod-sale-bg)",
  },
];
