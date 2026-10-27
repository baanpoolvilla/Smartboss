"use client";

import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { TaskCard } from "@/modules/report_task/components/kanban/task-card";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { isOthersPersonalTask, isPersonalTask } from "@/modules/report_task/lib/personal-task";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useChatStore, type RoomMessage } from "../store/chat-store";
import type { ChatChannelSummary, ChatTaskCard } from "../types";
import { postTaskCard } from "../lib/api";
import { channelTitle } from "../lib/format";

/**
 * สร้างงานจากแชท (27/10/2569 "สร้างงานจากแชทที่คุยอยู่เรื่องนั้นเลย … ให้เหมือนของ task")
 * - กดค้างที่ข้อความ → "เปิดเป็นงาน" / ปุ่ม + → "สร้างงาน" ⇒ หน้าสร้างงานตัวเดียวกับบอร์ด เด้งทับแชท
 *   เติมชื่อ/รายละเอียด/ผู้รับผิดชอบ/ไฟล์จากข้อความให้
 * - สร้างเสร็จ → การ์ดงาน (TaskCard ตัวจริงของบอร์ด) ลงห้อง · กดการ์ด = หน้ารายละเอียดงานเปิดทับแชท
 * ส่งสัญญาณผ่าน window event แบบการ์ดอัลบั้ม — ไม่ต้องส่ง prop ผ่านรายการข้อความหลายชั้น
 */
export const CHAT_CREATE_TASK_EVENT = "chat:create-task";
export const CHAT_OPEN_TASK_EVENT = "chat:open-task";
export type CreateTaskDetail = { channelId: string; message?: RoomMessage };

export function requestCreateTask(detail: CreateTaskDetail) {
  window.dispatchEvent(new CustomEvent<CreateTaskDetail>(CHAT_CREATE_TASK_EVENT, { detail }));
}
export function requestOpenTask(taskId: string) {
  window.dispatchEvent(new CustomEvent<{ taskId: string }>(CHAT_OPEN_TASK_EVENT, { detail: { taskId } }));
}

/** ข้อความที่เปิดเป็นงานได้ — มีเนื้อหาจริง (ไม่ใช่การ์ด/ข้อความระบบ/ที่ยกเลิกแล้ว/ยังส่งไม่เสร็จ) */
export function canOpenAsTask(m: RoomMessage): boolean {
  return !m.deleted && !m.status && (m.kind === "text" || m.kind === "note") && (!!m.body || m.attachments.some((a) => !!a.url && !a.expired && a.kind !== "sticker"));
}

/** การ์ดงานในห้อง — งานที่อยู่ใน store ใช้การ์ดตัวจริงของบอร์ด (สถานะเปลี่ยนตามบอร์ดทันที) */
export function ChatTaskCardView({ message, mine }: { message: RoomMessage; mine: boolean }) {
  const card = message.task;
  const meId = useChatStore((s) => s.meId);
  const task = useTaskStore((s) => (card ? s.tasks.find((t) => t.id === card.taskId) : undefined));
  if (!card) {
    return <div className="rounded-2xl border border-dashed border-(--line) px-3 py-2 text-sm text-(--ink-soft)">งานนี้ถูกลบแล้ว</div>;
  }
  const visible = task && !isOthersPersonalTask(task, meId);
  return (
    <div className={cn("flex w-[min(300px,72vw)] flex-col gap-1", mine ? "items-end" : "items-start")}>
      <span className="flex items-center gap-1 px-1 text-[11px] text-(--chat-meta)">
        <ClipboardList className="h-3.5 w-3.5" /> สร้างงาน · {card.code}
      </span>
      {visible ? (
        <div className="w-full text-left">
          <TaskCard task={task} onOpen={requestOpenTask} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => requestOpenTask(card.taskId)}
          className="w-full rounded-xl border border-(--line) bg-(--bg) px-3 py-2.5 text-left shadow-sm hover:bg-(--bg-soft)"
        >
          <p className="text-sm font-semibold text-(--ink)">{card.title}</p>
          <p className="mt-0.5 text-xs text-(--ink-soft)">กำหนดส่ง {new Date(card.dueDate).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}</p>
        </button>
      )}
    </div>
  );
}

/** ป้ายใต้ข้อความที่เปิดเป็นงานแล้ว */
export function LinkedTaskBadge({ card, mine }: { card: ChatTaskCard; mine: boolean }) {
  return (
    <button
      type="button"
      onClick={() => requestOpenTask(card.taskId)}
      className={cn(
        "mt-0.5 inline-flex items-center gap-1 rounded-full border border-(--line) bg-(--bg) px-2 py-0.5 text-[11px] text-(--ink-soft) hover:text-(--ink)",
        mine ? "self-end" : "self-start"
      )}
    >
      <ClipboardList className="h-3 w-3" /> เปิดเป็นงานแล้ว · {card.code}
    </button>
  );
}

interface Prefill {
  key: number;
  title: string;
  description: string;
  assigneeIds: string[];
  files: File[];
  sourceMessageId: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** ตัวดูแลหน้าสร้างงาน + หน้ารายละเอียดงาน ของห้องที่เปิดอยู่ */
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
        sourceMessageId: m?.id ?? null,
      });
    };
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (!id) return;
      if (!useTaskStore.getState().tasks.some((t) => t.id === id)) {
        toast.error("เปิดงานนี้ไม่ได้ — ไม่มีสิทธิ์ดู หรือถูกลบแล้ว");
        return;
      }
      setOpenTaskId(id);
    };
    window.addEventListener(CHAT_CREATE_TASK_EVENT, onCreate);
    window.addEventListener(CHAT_OPEN_TASK_EVENT, onOpen);
    return () => {
      window.removeEventListener(CHAT_CREATE_TASK_EVENT, onCreate);
      window.removeEventListener(CHAT_OPEN_TASK_EVENT, onOpen);
    };
  }, [channel, meId, users]);

  async function sendCard(taskId: string, sourceMessageId: string | null) {
    const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
    if (task && isPersonalTask(task)) {
      toast.success("สร้างงานส่วนตัวแล้ว — งานส่วนตัวไม่ส่งการ์ดลงห้อง");
      return;
    }
    // บอร์ดบันทึกงานขึ้นเซิร์ฟเวอร์แบบหน่วง — งานยังไม่มี (404) ก็รอแล้วลองใหม่
    for (let i = 0; i < 12; i++) {
      const r = await postTaskCard(channel.id, taskId, sourceMessageId);
      if (r.ok) return;
      if (r.status !== 404) {
        toast.error(r.error ?? "ส่งการ์ดงานลงห้องไม่สำเร็จ");
        return;
      }
      await sleep(1500);
    }
    toast.error("สร้างงานแล้ว แต่ส่งการ์ดงานลงห้องไม่สำเร็จ");
  }

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
            const source = prefill.sourceMessageId;
            setPrefill(null);
            void sendCard(taskId, source);
          }}
        />
      )}
      <TaskDetailSheet taskId={openTaskId} onOpenChange={(v) => !v && setOpenTaskId(null)} />
    </>
  );
}
