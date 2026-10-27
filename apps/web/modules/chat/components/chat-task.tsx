"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { useChatStore, type RoomMessage } from "../store/chat-store";
import type { ChatChannelSummary } from "../types";
import { channelTitle } from "../lib/format";

/**
 * สร้างงานจากแชท (27/10/2569 "สร้างงานจากแชทที่คุยอยู่เรื่องนั้นเลย … ให้เหมือนของ task")
 * กดค้างที่ข้อความ → "เปิดเป็นงาน" / ปุ่ม + → "สร้างงาน" ⇒ หน้าสร้างงานตัวเดียวกับบอร์ด เด้งทับแชท
 * เติมชื่อ/รายละเอียด/ผู้รับผิดชอบ/ไฟล์จากข้อความให้
 * ไม่ส่งการ์ดลงห้อง — ผู้รับผิดชอบได้แจ้งเตือน "มอบหมายงานให้คุณ" ตามปกติของงาน ("ไม่ต้องเห็นในแชท … เดี๋ยวงง")
 * ส่งสัญญาณผ่าน window event แบบการ์ดอัลบั้ม — ไม่ต้องส่ง prop ผ่านรายการข้อความหลายชั้น
 */
export const CHAT_CREATE_TASK_EVENT = "chat:create-task";
export type CreateTaskDetail = { channelId: string; message?: RoomMessage };

export function requestCreateTask(detail: CreateTaskDetail) {
  window.dispatchEvent(new CustomEvent<CreateTaskDetail>(CHAT_CREATE_TASK_EVENT, { detail }));
}

/** ข้อความที่เปิดเป็นงานได้ — มีเนื้อหาจริง (ไม่ใช่การ์ด/ข้อความระบบ/ที่ยกเลิกแล้ว/ยังส่งไม่เสร็จ) */
export function canOpenAsTask(m: RoomMessage): boolean {
  return !m.deleted && !m.status && (m.kind === "text" || m.kind === "note") && (!!m.body || m.attachments.some((a) => !!a.url && !a.expired && a.kind !== "sticker"));
}

interface Prefill {
  key: number;
  title: string;
  description: string;
  assigneeIds: string[];
  files: File[];
}

/** ไฟล์ในข้อความ → File สำหรับแนบในงาน (ดึงไม่ได้ก็ข้าม ไม่ล้มทั้งหมด) */
async function filesOf(m: RoomMessage): Promise<File[]> {
  const list = m.attachments.filter((a) => !!a.url && !a.expired && a.kind !== "sticker" && a.kind !== "audio").slice(0, 10);
  const out = await Promise.all(
    list.map(async (a) => {
      try {
        const res = await fetch(a.url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new File([blob], a.name || "ไฟล์จากแชท", { type: a.mime || blob.type });
      } catch {
        return null;
      }
    })
  );
  return out.filter((f): f is File => f !== null);
}

/** หน้าสร้างงาน (เติมจากข้อความ) ของห้องที่เปิดอยู่ + หน้ารายละเอียดงานหลังสร้าง */
export function ChatTaskHost({ channel }: { channel: ChatChannelSummary }) {
  const meId = useChatStore((s) => s.meId);
  const users = useChatStore((s) => s.users);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    const onCreate = async (e: Event) => {
      const d = (e as CustomEvent<CreateTaskDetail>).detail;
      if (d?.channelId !== channel.id) return;
      const room = channelTitle(channel, meId, users);
      const m = d.message;
      // ผู้รับผิดชอบเริ่มต้น: แชท 1:1 = อีกฝ่าย · กลุ่ม = คนพิมพ์ข้อความนั้น (ถ้าไม่ใช่ตัวเอง) — แก้ได้ก่อนกดสร้าง
      const other = channel.type === "dm" ? channel.memberIds.find((id) => id !== meId) : undefined;
      const assignee = other ?? (m && m.authorId !== meId ? m.authorId : undefined);
      const body = m?.body?.trim() ?? "";
      const firstLine = body.split("\n").find((l) => l.trim())?.trim() ?? "";
      const when = m ? new Date(m.createdAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      const files = m ? await filesOf(m) : [];
      setPrefill({
        key: Date.now(),
        title: firstLine.slice(0, 100) || (m ? `งานจากแชท ${room}` : ""),
        description: m ? `${body}${body ? "\n\n" : ""}— จากแชท "${room}" · ${users[m.authorId]?.name ?? "สมาชิก"} · ${when}` : "",
        assigneeIds: assignee ? [assignee] : [],
        files,
      });
    };
    window.addEventListener(CHAT_CREATE_TASK_EVENT, onCreate);
    return () => window.removeEventListener(CHAT_CREATE_TASK_EVENT, onCreate);
  }, [channel, meId, users]);

  return (
    <>
      {prefill && (
        <NewTaskDialog
          key={prefill.key}
          open
          onOpenChange={(v) => !v && setPrefill(null)}
          defaultType="task"
          allowedTypes={["task"]}
          defaultTitle={prefill.title}
          defaultDescription={prefill.description}
          defaultAssigneeIds={prefill.assigneeIds}
          defaultFiles={prefill.files}
          onCreated={(taskId) => {
            setPrefill(null);
            toast.success("สร้างงานแล้ว — ผู้รับผิดชอบได้แจ้งเตือน", {
              action: { label: "เปิดงาน", onClick: () => setOpenTaskId(taskId) },
            });
          }}
        />
      )}
      <TaskDetailSheet taskId={openTaskId} onOpenChange={(v) => !v && setOpenTaskId(null)} />
    </>
  );
}
