import { Car, MessageCircle, Send, type LucideIcon } from "lucide-react";

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
/** แอปอยู่การ์ดไหนในหน้าหลัก — "งานขาย" (/sales-marketing/sale) หรือ "การตลาด" (/sales-marketing/marketing) */
export type ExternalAppGroup = "sale" | "marketing";

export const EXTERNAL_APP_GROUPS: Record<ExternalAppGroup, { title: string; subtitle: string; moduleCode: string }> = {
  sale: { title: "งานขาย", subtitle: "เว็บของทีมขาย", moduleCode: "sale_admin" },
  marketing: { title: "การตลาด", subtitle: "เว็บของทีมการตลาด", moduleCode: "marketing" },
};

/**
 * "home" = ไม่อยู่ใต้การ์ดทีมไหน — ขึ้นเป็นไอคอนของตัวเองฝั่งขวา ("อื่น ๆ") ของหน้าแรก
 * (เว็บใช้ภายในทั้งบริษัท เช่น ระบบใช้รถ — ไม่ใช่ของทีมขาย/การตลาด)
 */
export type ExternalAppPlacement = ExternalAppGroup | "home";

export interface ExternalApp {
  group: ExternalAppPlacement;
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
    group: "marketing",
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
    group: "sale",
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
  {
    group: "home",
    name: "ใช้รถบริษัท",
    description: "ขอใช้รถ อนุมัติ ตรวจสภาพรถก่อน–หลัง",
    url: "https://carapprove.vercel.app/",
    // ล็อกอินให้เลยแบบ Multi Post — ฝั่งเว็บรถต้องมีหน้า /sso ตาม docs/carapprove-sso.md
    // ยังไม่ตั้ง SSO_CARAPPROVE_SECRET = เปิดหน้าเว็บรถธรรมดา (ล็อกอินเองในกรอบ) ไม่พัง
    // embed=1 → เว็บรถต้องตั้ง cookie แบบ SameSite=None; Secure; Partitioned ไม่งั้นในกรอบล็อกอินแล้วหลุด
    sso: {
      key: "carapprove",
      secretEnv: "SSO_CARAPPROVE_SECRET",
      entry: "https://carapprove.vercel.app/sso?token={token}",
      embedParam: "embed=1",
    },
    icon: Car,
    color: "#1d4ed8",
    colorBg: "#dbeafe",
  },
];

/** ชื่อในลิงก์ของแอป — /sales-marketing/app/<key> (หน้าที่เปิดแอปไว้ข้างใน SmartBoss) */
export function appKey(app: ExternalApp): string {
  return app.sso?.key ?? new URL(app.url).host.split(".")[0]!;
}

export function appsInGroup(group: ExternalAppPlacement): ExternalApp[] {
  return SALES_MARKETING_APPS.filter((a) => a.group === group);
}
