"use client";

import type {
  ChatAttachment,
  ChatChannelDetail,
  ChatChannelSummary,
  ChatMessageDTO,
  ChatReactionDTO,
  ChatUser,
} from "../types";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => json<T>(r));
}

const ch = (id: string) => `/api/chat/channels/${encodeURIComponent(id)}`;

export function fetchChannels(): Promise<{ channels: ChatChannelSummary[] }> {
  return fetch("/api/chat/channels").then((r) => json(r));
}

export function fetchChannelDetail(id: string): Promise<{ channel: ChatChannelDetail }> {
  return fetch(ch(id)).then((r) => json(r));
}

export function fetchOrgUsers(): Promise<{ users: ChatUser[]; onlineIds: string[] }> {
  return fetch("/api/chat/users").then((r) => json(r));
}

export function fetchUnread(): Promise<{ unread: number; userId: string; mutedIds: string[] }> {
  return fetch("/api/chat/unread").then((r) => json(r));
}

export function startDm(memberId: string): Promise<{ channelId: string }> {
  return send("/api/chat/channels", "POST", { type: "dm", memberId });
}

export function createGroupChannel(name: string, memberIds: string[]): Promise<{ channelId: string }> {
  return send("/api/chat/channels", "POST", { type: "group", name, memberIds });
}

export function updateChannel(
  id: string,
  patch: { name?: string; announcementId?: string | null; pinned?: boolean; muted?: boolean }
): Promise<{ ok: true }> {
  return send(ch(id), "PATCH", patch);
}

export function addChannelMembers(id: string, userIds: string[]): Promise<{ ok: true }> {
  return send(`${ch(id)}/members`, "POST", { userIds });
}

export function setChannelMemberRole(id: string, userId: string, role: "admin" | "member"): Promise<{ ok: true }> {
  return send(`${ch(id)}/members`, "PATCH", { userId, role });
}

/** userId ไม่ใส่ = ออกจากกลุ่มเอง */
export function removeChannelMember(id: string, userId?: string): Promise<{ ok: true }> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return send(`${ch(id)}/members${qs}`, "DELETE");
}

export interface MessagePage {
  messages: ChatMessageDTO[];
  hasMore: boolean;
}

export function fetchMessages(channelId: string, opts: { after?: string; before?: string; around?: string } = {}): Promise<MessagePage> {
  const qs = new URLSearchParams();
  if (opts.after) qs.set("after", opts.after);
  if (opts.before) qs.set("before", opts.before);
  if (opts.around) qs.set("around", opts.around);
  const s = qs.toString();
  return fetch(`${ch(channelId)}/messages${s ? `?${s}` : ""}`).then((r) => json(r));
}

export function searchChannelMessages(channelId: string, q: string): Promise<MessagePage> {
  return fetch(`${ch(channelId)}/messages?q=${encodeURIComponent(q)}`).then((r) => json(r));
}

export function fetchChannelMedia(channelId: string, kind: "media" | "file" | "link", before?: string): Promise<MessagePage> {
  const qs = new URLSearchParams({ kind });
  if (before) qs.set("before", before);
  return fetch(`${ch(channelId)}/media?${qs}`).then((r) => json(r));
}

export function sendMessage(
  channelId: string,
  input: { body?: string; attachments?: ChatAttachment[]; replyToId?: string; mentions?: string[]; clientId: string }
): Promise<{ message: ChatMessageDTO }> {
  return send(`${ch(channelId)}/messages`, "POST", input);
}

export function deleteMessage(channelId: string, messageId: string): Promise<{ ok: true }> {
  return send(`${ch(channelId)}/messages/${encodeURIComponent(messageId)}`, "DELETE");
}

export function toggleReaction(channelId: string, messageId: string, emoji: string): Promise<{ reactions: ChatReactionDTO[] }> {
  return send(`${ch(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`, "POST", { emoji });
}

export function markChannelRead(channelId: string): Promise<{ lastReadSeq: string | null }> {
  return send(`${ch(channelId)}/read`, "POST");
}

export function sendTyping(channelId: string): Promise<unknown> {
  return fetch(`${ch(channelId)}/typing`, { method: "POST" }).catch(() => undefined);
}

/** อัปโหลดพร้อมรายงานความคืบหน้า (fetch ยังบอกความคืบหน้าขาอัปไม่ได้ จึงใช้ XHR) */
export function uploadAttachment(
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/chat/uploads");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as ChatAttachment);
      else reject(new Error(body?.error ?? (xhr.status === 413 ? "ไฟล์ใหญ่เกินไป" : "อัปโหลดไม่สำเร็จ")));
    };
    xhr.onerror = () => reject(new Error("อัปโหลดไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"));
    xhr.onabort = () => reject(new DOMException("ยกเลิกแล้ว", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
