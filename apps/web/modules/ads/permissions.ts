/**
 * Permission codes ของโมดูล Google Ads — ต้องตรงกับ ADS_PERMS ใน
 * packages/database/defaults.ts
 *
 * ตั้งแต่ 17/11/2569 AI ทั้งหมดอยู่บน n8n — Smartboss เก็บข้อมูล แสดงผล และเป็นที่อนุมัติ
 */
export const ADS_PERMS = {
  /** แดชบอร์ด · ดูคำขอปรับ (คนอนุมัติ = สมาชิกกลุ่มแชท 🤖 Ads Agent ไม่ใช่ permission) */
  access: "ads.access",
  /** เกณฑ์ KPI และกฎการวิเคราะห์ — ผู้ดูแลระบบ + หัวหน้าการตลาด */
  settingManage: "ads.setting.manage",
  /** การเชื่อมต่อ n8n — ออก token · ตั้ง webhook · นโยบายคำขอปรับ · เป็นแอดมินกลุ่ม Ads Agent ตอนสร้างกลุ่ม */
  admin: "ads.admin",
} as const;

export const ALL_ADS_PERMS: string[] = Object.values(ADS_PERMS);

export const ADS_PERM_LABELS: Record<string, string> = {
  [ADS_PERMS.access]: "ดูรายงาน Google Ads และคำขอปรับ",
  [ADS_PERMS.settingManage]: "แก้เกณฑ์ KPI กฎการวิเคราะห์ และเป้าหมายธุรกิจ",
  [ADS_PERMS.admin]: "ตั้งค่าการเชื่อมต่อ n8n (token · webhook · นโยบาย)",
};
