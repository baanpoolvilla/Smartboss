import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  Users,
  Wallet,
  Wrench,
  ShoppingCart,
  Megaphone,
} from "lucide-react";

export interface ModuleCard {
  code: string;
  name: string;
  description: string;
  /** CSS variable name ของสีโมดูล (อ้างอิงจาก tokens.css — ห้าม hardcode hex) */
  colorVar: string;
  colorBgVar: string;
  icon: LucideIcon;
}

/** ข้อมูลแสดงผลของ 6 โมดูล (Coming Soon) — สีอ้างจาก CSS variable */
export const MODULE_CARDS: ModuleCard[] = [
  {
    code: "report_task",
    name: "รายงานและงาน",
    description: "ติดตามงานและสรุปรายงานประจำวัน",
    colorVar: "--mod-report",
    colorBgVar: "--mod-report-bg",
    icon: ClipboardList,
  },
  {
    code: "hr",
    name: "ระบบบุคคล",
    description: "จัดการพนักงาน วันลา และเวลาทำงาน",
    colorVar: "--mod-hr",
    colorBgVar: "--mod-hr-bg",
    icon: Users,
  },
  {
    code: "financial",
    name: "การเงิน",
    description: "รายรับรายจ่ายและงบประมาณ",
    colorVar: "--mod-financial",
    colorBgVar: "--mod-financial-bg",
    icon: Wallet,
  },
  {
    code: "maintenance",
    name: "แจ้งซ่อมบำรุง",
    description: "แจ้งซ่อมและติดตามสถานะงานช่าง",
    colorVar: "--mod-maintenance",
    colorBgVar: "--mod-maintenance-bg",
    icon: Wrench,
  },
  {
    code: "sale_admin",
    name: "งานขาย",
    description: "ดูแลออเดอร์และข้อมูลลูกค้า",
    colorVar: "--mod-sale",
    colorBgVar: "--mod-sale-bg",
    icon: ShoppingCart,
  },
  {
    code: "marketing",
    name: "การตลาด",
    description: "แคมเปญและช่องทางการสื่อสาร",
    colorVar: "--mod-marketing",
    colorBgVar: "--mod-marketing-bg",
    icon: Megaphone,
  },
];

/**
 * โมดูลหลักที่ปักไว้ฝั่งซ้ายของหน้ารวมแอป (ที่เหลือไปอยู่ฝั่งขวา)
 *
 * ค่านี้เป็น **ค่าตั้งต้น** ของบริษัทที่ยังไม่เคยตั้งค่าเท่านั้น — วันไหนมีตาราง
 * settings รายบริษัท ให้หน้ารวมแอปอ่านจากตารางก่อน แล้วค่อย fallback มาที่นี่
 * (แต่ละบริษัทใช้โมดูลหลักไม่เหมือนกัน ห้าม switch ตามโค้ดโมดูลที่อื่น)
 */
export const PRIMARY_MODULE_CODES: readonly string[] = [
  "report_task",
  "hr",
  "maintenance",
];
