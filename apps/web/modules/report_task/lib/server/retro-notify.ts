import "server-only";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import type { AppNotification } from "@/modules/report_task/store/notification-store";

/** แจ้งเตือนจากระบบ (ไม่มีผู้กด) ลงกระดิ่งของแต่ละคน — id ซ้ำไม่เพิ่มซ้ำ */
export async function writeOwnNotificationsForUsers(
  orgId: string,
  items: { id: string; userId: string; message: string; link?: string }[]
): Promise<void> {
  if (items.length === 0) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: existing, version } = await readStore<AppNotification[]>(orgId, "notifications");
    const list = existing ?? [];
    const have = new Set(list.map((n) => n.id));
    const fresh: AppNotification[] = items
      .filter((i) => !have.has(i.id))
      .map((i) => ({
        id: i.id,
        userId: i.userId,
        byUserId: i.userId,
        message: i.message,
        link: i.link,
        createdAt: new Date().toISOString(),
        read: false,
      }));
    if (fresh.length === 0) return;
    const result = await writeStore(orgId, "notifications", [...fresh, ...list], version);
    if (result.ok) return;
  }
}
