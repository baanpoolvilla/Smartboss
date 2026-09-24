import type { ChatAttachmentKind, ChatChannelSummary, ChatUser } from "../types";

function timeOf(d: Date): string {
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

/** เวลาข้างฟองข้อความ — "10:32" */
export function formatClock(iso: string): string {
  return timeOf(new Date(iso));
}

/** เวลาในรายการห้อง แบบ LINE — วันนี้ "10:32", เมื่อวาน, ในสัปดาห์นี้ "จ.", เก่ากว่านั้น "12 ก.ย." */
export function formatListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOf(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "เมื่อวาน";
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (diffDays < 6) return d.toLocaleDateString("th-TH", { weekday: "short" });
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "2-digit" } : {}) });
}

/** ป้ายคั่นวันในห้องแชท — "วันนี้", "เมื่อวาน", "พ. 24 ก.ย." */
export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "วันนี้";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "เมื่อวาน";
  return d.toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** เดิมใช้ใต้ข้อความ — คงไว้ให้ที่อื่นที่ยังเรียกอยู่ */
export function formatMessageTime(iso: string): string {
  return `${formatDayLabel(iso) === "วันนี้" ? "" : `${formatDayLabel(iso)} `}${formatClock(iso)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function attachmentLabel(kind: ChatAttachmentKind | null): string {
  switch (kind) {
    case "image":
      return "ส่งรูปภาพ";
    case "video":
      return "ส่งวิดีโอ";
    case "audio":
      return "ส่งข้อความเสียง";
    case "file":
      return "ส่งไฟล์";
    default:
      return "";
  }
}

export function firstName(name: string | undefined): string {
  return name?.split(" ")[0] ?? "";
}

/** ชื่อห้องที่แสดง — DM ใช้ชื่ออีกฝั่ง */
export function channelTitle(channel: Pick<ChatChannelSummary, "type" | "name" | "memberIds">, meId: string, users: Record<string, ChatUser>): string {
  if (channel.type === "org") return channel.name ?? "ห้องรวมทั้งบริษัท";
  if (channel.type === "dm") {
    const other = channel.memberIds.find((id) => id !== meId);
    return (other && users[other]?.name) || "แชทส่วนตัว";
  }
  return channel.name ?? "กลุ่ม";
}

/** ข้อความสั้นใต้ชื่อห้องในรายการ */
export function channelPreview(channel: ChatChannelSummary, meId: string, users: Record<string, ChatUser>): string {
  const last = channel.lastMessage;
  if (!last) return channel.type === "org" ? "ห้องสำหรับทุกคนในบริษัท" : "ยังไม่มีข้อความ";
  if (last.kind === "system") return last.body ?? "";
  const who = last.authorId === meId ? "คุณ" : firstName(users[last.authorId]?.name) || "สมาชิก";
  if (last.deleted) return `${who} ยกเลิกข้อความ`;
  const text = last.body?.replace(/\s+/g, " ") || attachmentLabel(last.attachmentKind);
  return channel.type === "dm" && last.authorId !== meId ? text : `${who}: ${text}`;
}

/** true = วันเดียวกัน (ใช้คั่นวันในห้อง) */
export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
