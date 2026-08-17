/**
 * ชนิดข้อมูลของโมดูลแชท — ไฟล์นี้ไม่มี "server-only" และไม่ import อะไรที่ผูกกับ
 * เซิร์ฟเวอร์ (prisma ฯลฯ) โดยตั้งใจ เพื่อให้ทั้ง data/*.ts (server) และ
 * store/components ฝั่ง client import ชนิดเดียวกันได้ ไม่ต้องประกาศซ้ำสองที่
 */

export interface ChatAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
}

export interface ChatMessageDTO {
  id: string;
  /** ChatMessage.seq (bigint) เป็นสตริง — ใช้เป็น cursor ตอนโพล (?after=<seq>)
   * ไม่ใช่ id/createdAt เพราะสองอันนั้นเรียงลำดับ/เทียบ ">" ไม่ปลอดภัยพอ */
  seq: string;
  channelId: string;
  authorId: string;
  body: string | null;
  attachments: ChatAttachment[];
  createdAt: string;
}

export interface ChatChannelSummary {
  id: string;
  /** "dm" | "group" | "org" */
  type: string;
  name: string | null;
  memberIds: string[];
  unreadCount: number;
  lastMessage: {
    body: string | null;
    authorId: string;
    createdAt: string;
    hasAttachment: boolean;
  } | null;
}

export interface ChatUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}
