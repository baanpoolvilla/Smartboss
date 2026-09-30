/**
 * Permission codes ของโมดูล Google Ads Report — ต้องตรงกับ ADS_PERMS ใน
 * packages/database/defaults.ts (spec §7 สิทธิ์การเข้าถึง)
 */
export const ADS_PERMS = {
  /** หน้า 1–3: แดชบอร์ด อีเมลสรุป AI วิเคราะห์ (สั่งวิเคราะห์/ถาม AI/อัปเดตแผน/ส่งออก) */
  access: "ads.access",
  /** หน้า 5: เกณฑ์ KPI และกฎการวิเคราะห์ — ผู้ดูแลระบบ + หัวหน้าการตลาด */
  settingManage: "ads.setting.manage",
  /** หน้า 4: การเชื่อมต่อ Google Ads API ซิงค์ Backfill — ผู้ดูแลระบบ */
  admin: "ads.admin",
} as const;

export const ALL_ADS_PERMS: string[] = Object.values(ADS_PERMS);

export const ADS_PERM_LABELS: Record<string, string> = {
  [ADS_PERMS.access]: "ดูรายงาน Google Ads และใช้ AI วิเคราะห์",
  [ADS_PERMS.settingManage]: "แก้เกณฑ์ KPI กฎการวิเคราะห์ และเป้าหมายธุรกิจ",
  [ADS_PERMS.admin]: "ตั้งค่าการเชื่อมต่อ Google Ads API และสั่งซิงค์",
};
