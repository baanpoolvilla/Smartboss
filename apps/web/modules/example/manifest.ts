import type { ModuleManifest } from "@/module-registry";

/**
 * แม่แบบ manifest ของโมดูล — คัดลอกโฟลเดอร์นี้แล้วแก้ค่าเพื่อสร้างโมดูลใหม่
 * - id ต้องตรงกับ Module.code ใน DB (seed)
 * - permission ของแต่ละเมนู ใช้คุมการมองเห็นบน Sidebar
 */
export const EXAMPLE_PERMISSIONS = {
  view: "example.view",
  manage: "example.manage",
} as const;

export const exampleManifest: ModuleManifest = {
  id: "example",
  name: "โมดูลตัวอย่าง",
  color: "#4CB93F",
  colorBg: "#F3FBF1",
  basePath: "/example",
  icon: "Sparkles",
  menus: [
    {
      label: "รายการตัวอย่าง",
      path: "/example",
      permission: EXAMPLE_PERMISSIONS.view,
      icon: "List",
    },
  ],
  permissions: [EXAMPLE_PERMISSIONS.view, EXAMPLE_PERMISSIONS.manage],
};
