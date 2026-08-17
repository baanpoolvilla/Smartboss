"use client";

import type { ChatAttachment, ChatChannelSummary, ChatMessageDTO, ChatUser } from "../types";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export function fetchChannels(): Promise<{ channels: ChatChannelSummary[] }> {
  return fetch("/api/chat/channels").then((r) => json(r));
}

export function fetchOrgUsers(): Promise<{ users: ChatUser[] }> {
  return fetch("/api/chat/users").then((r) => json(r));
}

export function startDm(memberId: string): Promise<{ channelId: string }> {
  return fetch("/api/chat/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "dm", memberId }),
  }).then((r) => json(r));
}

export function createGroupChannel(name: string, memberIds: string[]): Promise<{ channelId: string }> {
  return fetch("/api/chat/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "group", name, memberIds }),
  }).then((r) => json(r));
}

export function fetchMessages(
  channelId: string,
  after?: string
): Promise<{ messages: ChatMessageDTO[]; deletedIds: string[] }> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : "";
  return fetch(`/api/chat/channels/${channelId}/messages${qs}`).then((r) => json(r));
}

export function deleteMessage(channelId: string, messageId: string): Promise<void> {
  return fetch(`/api/chat/channels/${channelId}/messages/${messageId}`, { method: "DELETE" }).then((r) => json(r));
}

export function sendMessage(
  channelId: string,
  input: { body?: string; attachments?: ChatAttachment[] }
): Promise<{ message: ChatMessageDTO }> {
  return fetch(`/api/chat/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => json(r));
}

export function markChannelRead(channelId: string): Promise<void> {
  return fetch(`/api/chat/channels/${channelId}/read`, { method: "POST" }).then(() => undefined);
}

export async function uploadAttachment(file: File): Promise<ChatAttachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/chat/uploads", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "อัปโหลดไม่สำเร็จ");
  return body as ChatAttachment;
}
