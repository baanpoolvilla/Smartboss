"use client";

import { Fragment, type ReactNode } from "react";
import type { ChatUser } from "../types";

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** แยกลิงก์ให้กดได้ */
function linkify(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <a
        key={`${keyPrefix}-${i}`}
        href={m[0]}
        target="_blank"
        rel="noreferrer noopener"
        className="break-all text-(--chat-mention) underline underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        {m[0]}
      </a>
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * เนื้อข้อความ — ลิงก์กดได้ และ @ชื่อ ของคนที่ถูกแท็กเป็นสีเด่น (ชื่อเราเองเด่นกว่าคนอื่น)
 * ไม่แปลง HTML ใด ๆ — ข้อความเป็นตัวอักษรล้วน ปลอดภัยจากการฝังสคริปต์
 */
export function MessageText({
  body,
  mentions,
  users,
  meId,
}: {
  body: string;
  mentions: string[];
  users: Record<string, ChatUser>;
  meId: string;
}) {
  const names = mentions
    .map((id) => (id === "all" ? { id, name: "ทุกคน" } : users[id] ? { id, name: users[id]!.name } : null))
    .filter((x): x is { id: string; name: string } => Boolean(x))
    .sort((a, b) => b.name.length - a.name.length);

  if (names.length === 0) return <>{linkify(body, "t")}</>;

  const re = new RegExp(`@(${names.map((n) => escapeRe(n.name)).join("|")})`, "g");
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(<Fragment key={`s${i}`}>{linkify(body.slice(last, i), `l${i}`)}</Fragment>);
    const target = names.find((n) => n.name === m[1]);
    const isMe = target?.id === meId || target?.id === "all";
    parts.push(
      <span
        key={`m${i}`}
        className={isMe ? "rounded bg-(--chat-mention)/15 px-0.5 font-semibold text-(--chat-mention)" : "font-semibold text-(--chat-mention)"}
      >
        {m[0]}
      </span>
    );
    last = i + m[0].length;
  }
  if (last < body.length) parts.push(<Fragment key="end">{linkify(body.slice(last), "e")}</Fragment>);
  return <>{parts}</>;
}
