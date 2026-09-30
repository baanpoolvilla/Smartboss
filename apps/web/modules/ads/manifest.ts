import type { ModuleManifest } from "@/module-registry";

import { ADS_BASE, ADS_CODE } from "./constants";
import { ADS_PERMS, ALL_ADS_PERMS } from "./permissions";

/**
 * โมดูล Google Ads Report (google-ads-report-module-spec.md) — ดึงข้อมูลโฆษณา
 * ทุกเช้า คำนวณ KPI เทียบเกณฑ์ ให้ AI เขียนสรุป + แผนปฏิบัติการ
 *
 * ใช้ภายในบริษัทเท่านั้น (spec แบบ A) — ปิดใช้งานทุกบริษัทโดยดีฟอลต์ (ไม่อยู่ใน
 * ENABLED_MODULES) เปิดที่ /admin/modules
 */
export const adsManifest: ModuleManifest = {
  id: ADS_CODE,
  name: "Google Ads Report",
  color: "#1A73E8",
  colorBg: "#EEF4FE",
  basePath: ADS_BASE,
  icon: "Megaphone",
  menus: [
    { label: "แดชบอร์ด", path: ADS_BASE, permission: ADS_PERMS.access, icon: "LayoutDashboard" },
    { label: "AI วิเคราะห์ผลโฆษณา", path: `${ADS_BASE}/analysis`, permission: ADS_PERMS.access, icon: "Sparkles" },
    { label: "อีเมลสรุปรายสัปดาห์", path: `${ADS_BASE}/email`, permission: ADS_PERMS.access, icon: "Mail" },
    { label: "เกณฑ์ KPI และกฎ", path: `${ADS_BASE}/settings/benchmarks`, permission: ADS_PERMS.settingManage, icon: "SlidersHorizontal" },
    { label: "การเชื่อมต่อ API", path: `${ADS_BASE}/settings/connection`, permission: ADS_PERMS.admin, icon: "PlugZap" },
  ],
  permissions: ALL_ADS_PERMS,
};
