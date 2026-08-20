import type { ReactNode } from "react";
import { resolvePermission } from "@smartboss/auth/permissions";

import { adminManifest } from "@/modules/admin/manifest";
import { chatManifest } from "@/modules/chat/manifest";
import { exampleManifest } from "@/modules/example/manifest";
import { hrManifest } from "@/modules/hr/manifest";
import { maintenanceManifest } from "@/modules/maintenance/manifest";
import { reportTaskManifest } from "@/modules/report_task/manifest";

export interface ModuleMenuItem {
  label: string;
  path: string;
  permission: string; // เมนูแสดงเมื่อ user มี permission นี้
  icon?: string; // ชื่อ icon จาก lucide-react
  /**
   * Discord-style unread pill rendered at the end of this menu's row in
   * `Shell`'s rail nav (see components/shell/shell.tsx's RailItem) — optional
   * live client component slot, e.g. report_task's "งาน / Kanban" entry uses
   * it to show a count of tasks waiting on someone's sign-off. Built once
   * here (a plain React element referencing a "use client" component), not
   * per-request data — the element itself is static, but once it hydrates on
   * the client it's a fully live component subscribing to whatever client
   * state it wants, same as any other Client Component. Most modules leave
   * this unset; Shell renders nothing when it's absent.
   */
  badge?: ReactNode;
}

export interface ModuleManifest {
  id: string; // ต้องตรงกับ Module.code ใน DB เช่น 'hr'
  name: string; // 'ระบบบุคคล'
  color: string; // '#3B82F6'
  colorBg: string; // '#EFF5FF'
  basePath: string; // '/hr'
  icon: string;
  menus: ModuleMenuItem[];
  permissions: string[];
  /**
   * true = โมดูลแกนของแพลตฟอร์ม ไม่ต้องซื้อ/เปิดใช้ (ข้ามการเช็ค OrgModule)
   * ใช้กับหลังบ้าน /admin ที่ทุกบริษัทต้องมี — การมองเห็นยังคุมด้วย permission ตามปกติ
   */
  alwaysOn?: boolean;
}

/**
 * ทะเบียนโมดูลทั้งหมดที่ "มีโค้ดอยู่ในระบบ" (ติดตั้งแล้ว)
 * การจะแสดงจริงยังต้องผ่าน 2 เงื่อนไข: บริษัทเปิดใช้ (OrgModule) + ผู้ใช้มีสิทธิ์
 * เพิ่มโมดูลใหม่ = สร้างโฟลเดอร์ modules/<code>/ แล้ว import manifest มาต่อท้ายอาร์เรย์นี้
 */
export const moduleRegistry: ModuleManifest[] = [
  adminManifest,
  exampleManifest,
  maintenanceManifest,
  // หน้าจออยู่ใน Smartboss แต่ข้อมูลมาจาก workforce API (โปรเซสแยก)
  hrManifest,
  // พอร์ตมาจากแอป easyboss-workspace ที่เคยรันเดี่ยว ๆ
  reportTaskManifest,
  // MVP แชทองค์กร — ปิดใช้งานทุกบริษัทโดยดีฟอลต์ เปิดทีละบริษัทได้ที่ /admin/modules
  chatManifest,
];

export interface VisibleModulesInput {
  /** permission codes ของผู้ใช้ */
  permissions: string[];
  /** role codes ของผู้ใช้ (SUPER_ADMIN เห็นทุกเมนู ยกเว้นกลุ่มเงินเดือน) */
  roles: string[];
  /** โมดูล (code) ที่บริษัทของผู้ใช้เปิดใช้งานอยู่ = subscription */
  enabledCodes: string[];
}

/**
 * คืนเฉพาะโมดูล+เมนูที่ผู้ใช้ควรเห็นบน Sidebar
 * เงื่อนไข: (1) บริษัทเปิดใช้โมดูลนั้น (2) ผู้ใช้มีสิทธิ์เมนูนั้น
 */
export function getVisibleModules({
  permissions,
  roles,
  enabledCodes,
}: VisibleModulesInput): ModuleManifest[] {
  const enabled = new Set(enabledCodes);

  return moduleRegistry
    .filter((m) => m.alwaysOn || enabled.has(m.id))
    .map((m) => ({
      ...m,
      // ใช้ตัวตัดสินเดียวกับฝั่ง server (packages/auth/permissions.ts) เพื่อไม่ให้
      // เมนูโผล่มาแล้วกดเข้าไปโดนเด้งออก — SUPER_ADMIN ผ่านหมดยกเว้นกลุ่มเงินเดือน
      menus: m.menus.filter((menu) =>
        resolvePermission({ permissions, roles, permission: menu.permission })
      ),
    }))
    .filter((m) => m.menus.length > 0);
}
