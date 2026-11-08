"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { whenHistorySettled } from "@/lib/back-to-close";
import {
  WORK_ORDER_DESCRIPTION_MAX,
  WORK_ORDER_PREFILL_KEY,
  WORK_ORDER_TITLE_MAX,
  type WorkOrderPrefill,
} from "@/modules/maintenance/lib/report-prefill";
import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { useChatStore, type RoomMessage } from "../store/chat-store";
import type { TaskSource } from "@/modules/report_task/types";
import type { ChatChannelSummary } from "../types";
import { channelTitle } from "../lib/format";

/**
 * สร้างงานจากแชท (27/10/2569 "สร้างงานจากแชทที่คุยอยู่เรื่องนั้นเลย … ให้เหมือนของ task")
 * กดค้างที่ข้อความ → "เปิดเป็นงาน" / ปุ่ม + → "สร้างงาน" ⇒ หน้าสร้างงานตัวเดียวกับบอร์ด เด้งทับแชท
 * เติมชื่อ/รายละเอียด/ผู้รับผิดชอบ/ไฟล์จากข้อความให้
 * ห้องกลุ่ม: การ์ดงานขึ้นในห้องนั้น ตอบกลับข้อความต้นทาง (8/11/2569 Os-Thanonchai "แสดงในหน้าที่สนทนาอยู่ เหมือน Microsoft")
 *   — เดิม 27/10 ไม่ส่งการ์ดลงห้อง · แชท 1:1 ได้การ์ดจากแจ้งเตือนมอบหมายงานอยู่แล้ว
 * ส่งสัญญาณผ่าน window event แบบการ์ดอัลบั้ม — ไม่ต้องส่ง prop ผ่านรายการข้อความหลายชั้น
 */
export const CHAT_CREATE_TASK_EVENT = "chat:create-task";
export type CreateTaskDetail = { channelId: string; message?: RoomMessage };

export function requestCreateTask(detail: CreateTaskDetail) {
  window.dispatchEvent(new CustomEvent<CreateTaskDetail>(CHAT_CREATE_TASK_EVENT, { detail }));
}

/** เปิดใบแจ้งซ่อมจากข้อความแชท (ผู้ใช้ 2/11/2569) — หน้าสร้างใบงานเดิม เติมหัวข้อ รายละเอียด และรูปให้ */
export const CHAT_CREATE_WORK_ORDER_EVENT = "chat:create-work-order";
export function requestCreateWorkOrder(detail: { channelId: string; message: RoomMessage }) {
  window.dispatchEvent(new CustomEvent(CHAT_CREATE_WORK_ORDER_EVENT, { detail }));
}

/** ข้อความที่เปิดเป็นงานได้ — มีเนื้อหาจริง (ไม่ใช่การ์ด/ข้อความระบบ/ที่ยกเลิกแล้ว/ยังส่งไม่เสร็จ) */
export function canOpenAsTask(m: RoomMessage): boolean {
  return !m.deleted && !m.status && (m.kind === "text" || m.kind === "note") && (!!m.body || m.attachments.some((a) => !!a.url && !a.expired && a.kind !== "sticker"));
}

interface Prefill {
  key: number;
  /** ข้อความต้นทาง — การ์ดงานในห้องกลุ่มตอบกลับข้อความนี้ */
  messageId?: string;
  title: string;
  description: string;
  assigneeIds: string[];
  files: File[];
  source: TaskSource;
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
  const router = useRouter();
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
        messageId: m?.id,
        title: firstLine.slice(0, 100) || (m ? `งานจากแชท ${room}` : ""),
        description: m ? `${body}${body ? "\n\n" : ""}— จากแชท "${room}" · ${users[m.authorId]?.name ?? "สมาชิก"} · ${when}` : "",
        assigneeIds: assignee ? [assignee] : [],
        files,
        source: {
          kind: "chat",
          label: m ? `แชท "${room}" · ข้อความของ ${users[m.authorId]?.name ?? "สมาชิก"}` : `แชท "${room}"`,
          link: `/chat-report/chat?c=${encodeURIComponent(channel.id)}${m ? `&m=${encodeURIComponent(m.id)}` : ""}`,
        },
      });
    };
    window.addEventListener(CHAT_CREATE_TASK_EVENT, onCreate);
    return () => window.removeEventListener(CHAT_CREATE_TASK_EVENT, onCreate);
  }, [channel, meId, users]);

  useEffect(() => {
    const onCreate = (e: Event) => {
      const d = (e as CustomEvent<{ channelId: string; message: RoomMessage }>).detail;
      if (d?.channelId !== channel.id) return;
      const m = d.message;
      const room = channelTitle(channel, meId, users);
      const author = users[m.authorId]?.name ?? "สมาชิก";
      const body = m.body?.trim() ?? "";
      const firstLine = body.split("\n").find((l) => l.trim())?.trim() ?? "";
      const when = new Date(m.createdAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const data: WorkOrderPrefill = {
        title: firstLine.slice(0, WORK_ORDER_TITLE_MAX) || `แจ้งซ่อมจากแชท ${room}`.slice(0, WORK_ORDER_TITLE_MAX),
        description: `${body}${body ? "\n\n" : ""}— จากแชท "${room}" · ${author} · ${when}`.slice(0, WORK_ORDER_DESCRIPTION_MAX),
        images: m.attachments
          .filter((a) => a.kind === "image" && !!a.url && !a.expired)
          .slice(0, 10)
          .map((a) => ({ url: a.url, name: a.name, mime: a.mime })),
        source: {
          label: `แชท "${room}" · ข้อความของ ${author}`,
          link: `/chat-report/chat?c=${encodeURIComponent(channel.id)}&m=${encodeURIComponent(m.id)}`,
        },
      };
      try {
        sessionStorage.setItem(WORK_ORDER_PREFILL_KEY, JSON.stringify(data));
      } catch {
        toast.error("เติมข้อมูลจากแชทไม่ได้ กรุณากรอกในหน้าสร้างใบงานเอง");
      }
      // เมนูข้อความเพิ่งปิด ระบบปุ่มย้อนกลับกำลังถอยประวัติ 1 ช่อง — push ทันทีจะถูกถอยทิ้ง
      setTimeout(() => whenHistorySettled(() => router.push("/maintenance/work-orders/new?fromReport=1")), 0);
    };
    window.addEventListener(CHAT_CREATE_WORK_ORDER_EVENT, onCreate);
    return () => window.removeEventListener(CHAT_CREATE_WORK_ORDER_EVENT, onCreate);
  }, [channel, meId, users, router]);

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
          source={prefill.source}
          onCreated={(taskId, title) => {
            const from = prefill;
            setPrefill(null);
            // ห้องกลุ่ม: การ์ดงานขึ้นในห้องที่คุยอยู่ ตอบกลับข้อความต้นทาง (ผู้ใช้ 8/11/2569 "เหมือน Microsoft") · 1:1 มีการ์ดอยู่แล้ว
            if (channel.type !== "dm") {
              void fetch(`/api/chat/channels/${encodeURIComponent(channel.id)}/task-card`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, title: title ?? from.title, replyToId: from.messageId ?? null }),
              }).catch(() => null);
            }
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
