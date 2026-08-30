// Plain types/constants shared between server actions (data/files.ts, a
// "use server" file that can only ever export async functions) and client
// components — kept in their own file for exactly that reason.

export const SHARE_LINK_ROLES = ["view", "edit"] as const;
export type ShareLinkRole = (typeof SHARE_LINK_ROLES)[number];

export const SHARE_LINK_ROLE_LABELS: Record<ShareLinkRole, string> = {
  view: "ดูได้อย่างเดียว",
  edit: "แก้ไขได้ (อัปโหลดเวอร์ชันใหม่ทับได้)",
};
