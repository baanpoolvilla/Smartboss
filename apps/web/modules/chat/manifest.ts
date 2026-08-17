import type { ModuleManifest } from "@/module-registry";

import { CHAT_BASE, CHAT_CODE } from "./constants";
import { ALL_CHAT_PERMS, CHAT_PERMS } from "./permissions";

/**
 * โมดูลแชท — MVP: ข้อความ + รูป/ไฟล์แนบ, ไม่มี websocket (poll เอา)
 *
 * ปิดใช้งานทุกบริษัทโดยดีฟอลต์ (ไม่อยู่ใน ENABLED_MODULES ของ
 * packages/database/defaults.ts) — เปิดทีละบริษัทได้ที่ /admin/modules
 * เพื่อทดสอบก่อนปล่อยให้ใช้จริงทั้งระบบ ตามที่ตกลงไว้
 */
export const chatManifest: ModuleManifest = {
  id: CHAT_CODE,
  name: "แชท",
  color: "#22C55E",
  colorBg: "#F0FDF4",
  basePath: CHAT_BASE,
  icon: "MessageCircle",
  menus: [
    {
      label: "แชท",
      path: CHAT_BASE,
      permission: CHAT_PERMS.access,
      icon: "MessageCircle",
    },
  ],
  permissions: ALL_CHAT_PERMS,
};
