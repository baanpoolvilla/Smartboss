import type { ModuleManifest } from "@/module-registry";

import { ADS_BASE, ADS_CODE } from "./constants";
import { ADS_PERMS, ALL_ADS_PERMS } from "./permissions";

/**
 * โมดูล Google Ads — ตั้งแต่ 17/11/2569 AI ทั้งหมดอยู่บน n8n (ผู้ใช้ตัดส่วน AI ออกจาก Smartboss)
 * n8n ดึงข้อมูลจาก Google Ads ส่งเข้ามา · เสนอคำขอปรับ · คนอนุมัติในแชท "🤖 Ads Agent" / หน้าคำขอปรับ
 * Smartboss เก็บข้อมูล คิด KPI (Rule Engine) แสดงผล และเป็นที่อนุมัติ — API สำหรับ n8n อยู่ที่ /api/agent/ads/*
 *
 * ปิดใช้งานทุกบริษัทโดยดีฟอลต์ (ไม่อยู่ใน ENABLED_MODULES) เปิดที่ /admin/modules
 */
export const adsManifest: ModuleManifest = {
  id: ADS_CODE,
  name: "Google Ads",
  color: "#1A73E8",
  colorBg: "#EEF4FE",
  basePath: ADS_BASE,
  icon: "Megaphone",
  menus: [
    { label: "แดชบอร์ด", path: ADS_BASE, permission: ADS_PERMS.access, icon: "LayoutDashboard" },
    { label: "คำขอปรับ", path: `${ADS_BASE}/proposals`, permission: ADS_PERMS.access, icon: "ClipboardCheck" },
    { label: "เกณฑ์ KPI และกฎ", path: `${ADS_BASE}/settings/benchmarks`, permission: ADS_PERMS.settingManage, icon: "SlidersHorizontal" },
    { label: "การเชื่อมต่อ n8n", path: `${ADS_BASE}/settings/connection`, permission: ADS_PERMS.admin, icon: "PlugZap" },
  ],
  permissions: ALL_ADS_PERMS,
};
