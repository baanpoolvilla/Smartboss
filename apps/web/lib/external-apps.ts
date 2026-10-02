import { MessageCircle, Send, type LucideIcon } from "lucide-react";

/**
 * เว็บภายนอกที่บริษัททำไว้เอง (ไม่ได้อยู่ใน SmartBoss) — รวมลิงก์ไว้ให้กดเปิด
 * จากหน้าโฮมที่เดียว ("อยากให้มารวมเปิดได้จากที่สมาร์ทบอส")
 *
 * แอปที่มี `sso` = ล็อกอินให้เลย: การ์ดพาไป /sales-marketing/open/<sso.key>
 * ซึ่งเซ็น token อายุสั้นด้วย env ของแอปนั้น (`sso.secretEnv`) แล้วส่งต่อไป
 * `sso.entry` ของแอป — ยังไม่ตั้ง env = เปิด `url` ธรรมดาเหมือนเดิม
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
  sso?: {
    key: string;
    /** ชื่อ env ที่เก็บ secret ร่วมกับแอปนั้น (ฝั่งแอปตั้งชื่อ SSO_SECRET) */
    secretEnv: string;
    /** ปลายทางที่รับ token — `{token}` ถูกแทนด้วย token จริง */
    entry: string;
    /** ต่อท้ายลิงก์ตอนเปิดในกรอบข้างใน SmartBoss — แอปใช้เลือกชนิด cookie ที่ใช้ในกรอบได้ (ดู lib/external-apps-sso.ts) */
    embedParam?: string;
  };
}

export const SALES_MARKETING_APPS: ExternalApp[] = [
  {
    name: "Multi Post System",
    description: "โพสต์ลงหลายช่องทางพร้อมกัน",
    url: "https://multipost-nu.vercel.app/",
    // เซิร์ฟเวอร์อ่านแล้วตั้ง cookie เอง จึงส่งใน query ได้ (อายุ 60 วินาที)
    // embed=1 → Multi Post ตั้ง session cookie แบบ SameSite=None; Partitioned (services/sessionCookie.js
    // ของ Multi Post) ไม่ใส่ = cookie แบบ Lax ที่เบราว์เซอร์ไม่ส่งในกรอบ ล็อกอินแล้วหลุดทันที
    sso: {
      key: "multipost",
      secretEnv: "SSO_MULTIPOST_SECRET",
      entry: "https://multipost-nu.vercel.app/sso?token={token}",
      embedParam: "embed=1",
    },
    icon: Send,
    color: "var(--mod-marketing)",
    colorBg: "var(--mod-marketing-bg)",
  },
  {
    name: "Baanpool-Chat",
    description: "แชทลูกค้า Baanpool",
    url: "https://baanpoolchat.vercel.app/login",
    // หน้าเว็บอ่านเองฝั่ง browser — ใส่หลัง # ไม่ให้ token ไปอยู่ใน log ของเซิร์ฟเวอร์
    // เก็บ session ใน localStorage + ส่ง Bearer (ไม่ใช้ cookie) — ในกรอบใช้ได้เลย ไม่ต้องมี embedParam
    sso: { key: "chat", secretEnv: "SSO_CHAT_SECRET", entry: "https://baanpoolchat.vercel.app/sso#token={token}" },
    icon: MessageCircle,
    color: "var(--mod-sale)",
    colorBg: "var(--mod-sale-bg)",
  },
];

/** ชื่อในลิงก์ของแอป — /sales-marketing/app/<key> (หน้าที่เปิดแอปไว้ข้างใน SmartBoss) */
export function appKey(app: ExternalApp): string {
  return app.sso?.key ?? new URL(app.url).host.split(".")[0]!;
}
