/**
 * ชนิดข้อมูลของโมดูลแชท — ไฟล์นี้ไม่มี "server-only" และไม่ import อะไรที่ผูกกับ
 * เซิร์ฟเวอร์ (prisma ฯลฯ) โดยตั้งใจ เพื่อให้ทั้ง data/*.ts (server) และ
 * store/components ฝั่ง client import ชนิดเดียวกันได้ ไม่ต้องประกาศซ้ำสองที่
 */

export type ChatAttachmentKind = "image" | "file" | "audio" | "video";

export interface ChatAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
  kind: ChatAttachmentKind;
  /** รูปย่อ (~400px) ไว้แสดงในห้อง — รูปเต็มโหลดเมื่อกดดูเท่านั้น */
  thumbUrl?: string;
  /** ขนาดรูปจริง — จองพื้นที่ไว้ก่อนรูปโหลดเสร็จ ข้อความจะได้ไม่กระโดด */
  width?: number;
  height?: number;
  /** ความยาวข้อความเสียง */
  durationMs?: number;
}

export interface ChatReactionDTO {
  emoji: string;
  userIds: string[];
}

export interface ChatReplyPreview {
  id: string;
  authorId: string;
  body: string | null;
  attachmentKind: ChatAttachmentKind | null;
  deleted: boolean;
}

export interface ChatMessageDTO {
  id: string;
  /** ChatMessage.seq (bigint) เป็นสตริง — ใช้เป็น cursor (?after=/?before=) และนับ "อ่านแล้ว" */
  seq: string;
  channelId: string;
  authorId: string;
  /** "text" | "system" */
  kind: string;
  body: string | null;
  attachments: ChatAttachment[];
  replyTo: ChatReplyPreview | null;
  mentions: string[];
  reactions: ChatReactionDTO[];
  /** รหัสที่เครื่องผู้ส่งสร้าง — ใช้จับคู่ข้อความ "กำลังส่ง" กับของจริงที่ส่งกลับมาทางท่อสด */
  clientId: string | null;
  /** ยกเลิกข้อความแล้ว — เหลือแค่ร่องรอย "ยกเลิกข้อความ" ไม่มีเนื้อหา */
  deleted: boolean;
  createdAt: string;
}

export interface ChatChannelSummary {
  id: string;
  /** "dm" | "group" | "org" */
  type: string;
  name: string | null;
  /** กลุ่มประจำแผนก (สมาชิกซิงก์อัตโนมัติ แก้สมาชิกเองไม่ได้) */
  departmentId: string | null;
  memberIds: string[];
  unreadCount: number;
  /** ข้อความที่ยังไม่อ่านซึ่ง @แท็กเรา */
  mentionCount: number;
  pinned: boolean;
  muted: boolean;
  lastMessage: {
    id: string;
    body: string | null;
    authorId: string;
    kind: string;
    attachmentKind: ChatAttachmentKind | null;
    deleted: boolean;
    createdAt: string;
  } | null;
  /** เวลาล่าสุดของห้อง (ข้อความล่าสุด หรือวันสร้างห้อง) — ใช้เรียงรายการ */
  activityAt: string;
}

export interface ChatChannelMemberDTO {
  userId: string;
  role: "admin" | "member";
}

export interface ChatChannelDetail {
  id: string;
  type: string;
  name: string | null;
  departmentId: string | null;
  /** ห้อง org ไม่มีรายชื่อสมาชิก (ทุกคนในบริษัท) — ฝั่ง client ใช้รายชื่อทั้งบริษัทแทน */
  members: ChatChannelMemberDTO[];
  /** อ่านถึงข้อความไหนแล้ว ต่อคน — ใช้นับ "อ่านแล้ว N" */
  readSeqs: Record<string, string>;
  announcement: ChatMessageDTO | null;
  /** ผู้ใช้คนนี้จัดการห้องได้ (เปลี่ยนชื่อ, สมาชิก, ปักประกาศ) */
  canManage: boolean;
}

export interface ChatUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
}

/** เหตุการณ์ที่ส่งผ่านท่อสด (/api/realtime) */
export type ChatRealtimeEvent =
  | {
      type: "chat.message";
      channelId: string;
      message: ChatMessageDTO;
      /** ไว้ขึ้นแจ้งเตือนในเว็บ (หน้าอื่นที่ไม่ได้โหลดรายชื่อ/ห้องไว้) */
      authorName?: string;
      channelName?: string | null;
      channelType?: string;
    }
  | { type: "chat.message.deleted"; channelId: string; messageId: string }
  | { type: "chat.reaction"; channelId: string; messageId: string; reactions: ChatReactionDTO[] }
  | { type: "chat.read"; channelId: string; userId: string; lastReadSeq: string }
  | { type: "chat.typing"; channelId: string; userId: string }
  | { type: "chat.channel"; channelId: string };

export const CHAT_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "✅", "🎉"] as const;
