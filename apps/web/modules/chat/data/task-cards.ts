import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@smartboss/database";

import type { ChatTaskCard } from "../types";
import { broadcastToChannel, getChannelAccess, getOrCreateDm } from "./channels";
import { hydrateMessages } from "./serialize";
import { readStore } from "@/modules/report_task/lib/db/org-store";

/**
 * การ์ด "งานใหม่" ลงแชทส่วนตัว คนมอบหมาย ↔ ผู้รับผิดชอบ (ผู้ใช้ 30/10/2569)
 * "เปิดสร้างงานจากที่ไหนก็ได้ … ให้เจ้าตัวรู้ · กดการ์ดในแชทแล้วไปหน้า task ที่เป็นรายละเอียด"
 *
 * เรียกจาก org-store (announceNewNotifications) ตอนมีแจ้งเตือน "มอบหมายงาน" ใหม่ — ทุกทางที่สร้าง/มอบหมายงาน
 * (บอร์ด, แชท, โปรเจกต์, เพิ่มผู้รับผิดชอบทีหลัง) วิ่งผ่านแจ้งเตือนนี้ที่เดียว
 *
 *  - ไม่เด้งแจ้งเตือนซ้ำ (แจ้งเตือนมอบหมายงานเด้งไปแล้ว) — นับเป็นยังไม่อ่านในแชทอย่างเดียว
 *  - กันซ้ำด้วย clientId = task-<taskId> ต่อห้องต่อคนมอบหมาย (มอบหมายงานเดิมซ้ำไม่โพสต์ใหม่)
 *  - ไม่ throw — การ์ดพลาดต้องไม่ทำให้การบันทึกงานพลาด
 */
export async function postTaskCard(
  orgId: string,
  input: { assignerId: string; assigneeId: string; taskId: string; title: string; link: string }
): Promise<void> {
  if (input.assignerId === input.assigneeId) return;
  try {
    // แจ้งเตือนกับตัวงานบันทึกคนละจังหวะ — งานใหม่อาจยังไม่ลงตาราง รอแป๊บแล้วอ่านอีกรอบ (ไม่เจอก็โพสต์โดยไม่มีวันส่ง)
    const readTask = () =>
      prisma.reportTask
        .findUnique({ where: { orgId_id: { orgId, id: input.taskId } }, select: { title: true, dueDate: true, code: true, parentId: true, data: true } })
        .catch(() => null);
    let task = await readTask();
    if (!task) {
      await new Promise((r) => setTimeout(r, 2500));
      task = await readTask();
    }
    // งานในโปรเจกต์ไม่ลงแชท (ผู้ใช้ 13/11/2569 "ไม่ขึ้นบนบอร์ดก็ไม่ต้องขึ้นในแชท งั้นงง") — แจ้งเตือนกระดิ่งยังมีตามปกติ
    if (isProjectTask(task)) return;
    const card: ChatTaskCard = {
      taskId: input.taskId,
      title: task?.title ?? input.title,
      dueDate: task?.dueDate || null,
      link: input.link,
      ...(task?.code ? { code: task.code } : {}),
      tags: taskTags(task),
      ...(await projectOf(orgId, task)),
    };
    await insertCard(orgId, {
      assignerId: input.assignerId,
      assigneeId: input.assigneeId,
      clientId: `task-${input.taskId}`,
      body: `มอบหมายงาน "${card.title}"`,
      card,
    });
  } catch (err) {
    // มอบหมายงานเดิมให้คนเดิมซ้ำ = การ์ดเดิมยังอยู่ในห้อง ไม่ต้องโพสต์ใหม่
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    console.error("[chat] task card failed", err);
  }
}

/**
 * การ์ดงานลงห้องแชทกลุ่มที่เปิดงานมา (ผู้ใช้ 8/11/2569 ตามที่ Os-Thanonchai ขอ: "ให้แสดงในหน้าที่สนทนาอยู่ เหมือน Microsoft")
 * ตอบกลับข้อความต้นทาง (replyToId) ให้เห็นว่างานนี้มาจากข้อความไหน · แชท 1:1 ไม่ต้อง (การ์ดลงแชทส่วนตัวอยู่แล้ว)
 * คนส่งต้องเป็นสมาชิกห้อง · กันซ้ำด้วย clientId = room-task-<taskId> · ไม่ throw ออกไปเป็น 500 ถ้าการ์ดซ้ำ
 */
export async function postTaskCardToRoom(
  orgId: string,
  input: { channelId: string; authorId: string; taskId: string; title: string; replyToId?: string | null; assigned?: boolean }
): Promise<{ posted: boolean }> {
  const access = await getChannelAccess({ orgId, userId: input.authorId, isChatAdmin: false }, input.channelId);
  if (access.type === "dm") return { posted: false };
  // งานใหม่บันทึกจากฝั่งเบราว์เซอร์ อาจยังไม่ลงตาราง — รอแป๊บแล้วอ่านอีกรอบ (แบบ postTaskCard)
  const readTask = () =>
    prisma.reportTask
      .findUnique({ where: { orgId_id: { orgId, id: input.taskId } }, select: { title: true, dueDate: true, code: true, parentId: true, data: true, assigneeIds: true } })
      .catch(() => null);
  let task = await readTask();
  if (!task) {
    await new Promise((r) => setTimeout(r, 2500));
    task = await readTask();
  }
  const card: ChatTaskCard = {
    taskId: input.taskId,
    title: task?.title ?? input.title.slice(0, 200),
    dueDate: task?.dueDate || null,
    link: `/report-task/tasks?task=${encodeURIComponent(input.taskId)}`,
    ...(task?.code ? { code: task.code } : {}),
    tags: taskTags(task),
    ...(await projectOf(orgId, task)),
    ...(await assigneeNames(orgId, task?.assigneeIds ?? [])),
  };
  const replyTo = input.replyToId
    ? await prisma.chatMessage.findFirst({ where: { orgId, channelId: input.channelId, id: input.replyToId }, select: { id: true } })
    : null;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          orgId,
          channelId: input.channelId,
          authorId: input.authorId,
          kind: "task",
          // "มอบหมายงาน" = หัวการ์ด "งานใหม่" (ห้องโปรเจกต์ — ผู้ใช้ 13/11/2569) · เปิดจากข้อความในห้อง = "เปิดงาน" เหมือนเดิม
          body: input.assigned ? `มอบหมายงาน "${card.title}"` : `เปิดงาน "${card.title}"`,
          meta: card as unknown as Prisma.InputJsonValue,
          clientId: `room-task-${input.taskId}`,
          ...(replyTo ? { replyToId: replyTo.id } : {}),
        },
      });
      await tx.chatReadState.upsert({
        where: { channelId_userId: { channelId: input.channelId, userId: input.authorId } },
        update: { lastReadSeq: created.seq, lastReadAt: created.createdAt },
        create: { channelId: input.channelId, userId: input.authorId, orgId, lastReadSeq: created.seq, lastReadAt: created.createdAt },
      });
      return created;
    });
    const [[message], author] = await Promise.all([
      hydrateMessages(orgId, [row]),
      prisma.user.findUnique({ where: { id: input.authorId }, select: { name: true } }),
    ]);
    await broadcastToChannel(orgId, input.channelId, { type: "chat.message", channelId: input.channelId, message: message!, authorName: author?.name, channelType: access.type });
    return { posted: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { posted: false };
    throw err;
  }
}

/**
 * การ์ด "ใบแจ้งซ่อมใหม่" ลงแชทส่วนตัว คนสร้างใบงาน ↔ ผู้รับผิดชอบ (ผู้ใช้ 2/11/2569 "อยากให้ทำแบบของ task")
 * เรียกตอนคนสร้างใบงานและมอบหมายให้คนอื่น · ใบรอบ PM (แบบนับรอบ) ส่งในนามคนสร้างแผน PM — ใบ PM อัตโนมัติแบบเดิมไม่มีการ์ด
 * ไม่ throw — การ์ดพลาดต้องไม่ทำให้การสร้างใบงานพลาด
 */
export async function postWorkOrderCard(
  orgId: string,
  input: { assignerId: string; assigneeId: string; workOrderId: string; title: string; dueDate: Date | null }
): Promise<void> {
  if (input.assignerId === input.assigneeId) return;
  try {
    const wo = await prisma.workOrder
      .findFirst({
        where: { orgId, id: input.workOrderId },
        select: { code: true, pmScheduleId: true, pmScheduleIds: true, autoCreated: true, createdBy: true },
      })
      .catch(() => null);
    await insertCard(orgId, {
      assignerId: input.assignerId,
      assigneeId: input.assigneeId,
      clientId: `wo-${input.workOrderId}`,
      body: `มอบหมายใบแจ้งซ่อม "${input.title}"`,
      card: {
        taskId: input.workOrderId,
        title: input.title,
        dueDate: input.dueDate?.toISOString() ?? null,
        link: `/maintenance/work-orders/${input.workOrderId}`,
        target: "work_order",
        ...(wo?.code ? { code: wo.code } : {}),
        tags: workOrderTags(wo),
      },
    });
  } catch (err) {
    // สร้างซ้ำ = การ์ดเดิม (clientId ซ้ำ) ไม่ถือว่าพลาด
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    console.error("[chat] work order card failed", err);
  }
}

async function insertCard(
  orgId: string,
  input: { assignerId: string; assigneeId: string; clientId: string; body: string; card: ChatTaskCard }
): Promise<void> {
  const channelId = await getOrCreateDm(orgId, input.assignerId, input.assigneeId);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        orgId,
        channelId,
        authorId: input.assignerId,
        kind: "task",
        body: input.body,
        meta: input.card as unknown as Prisma.InputJsonValue,
        clientId: input.clientId,
      },
    });
    // คนมอบหมายเห็นแล้วในตัว (ไม่ขึ้นยังไม่อ่านฝั่งตัวเอง)
    await tx.chatReadState.upsert({
      where: { channelId_userId: { channelId, userId: input.assignerId } },
      update: { lastReadSeq: created.seq, lastReadAt: created.createdAt },
      create: { channelId, userId: input.assignerId, orgId, lastReadSeq: created.seq, lastReadAt: created.createdAt },
    });
    return created;
  });
  const [[message], author] = await Promise.all([
    hydrateMessages(orgId, [row]),
    prisma.user.findUnique({ where: { id: input.assignerId }, select: { name: true } }),
  ]);
  await broadcastToChannel(
    orgId,
    channelId,
    { type: "chat.message", channelId, message: message!, authorName: author?.name, channelType: "dm" },
    [input.assignerId, input.assigneeId]
  );
}

/**
 * ป้ายประเภทบนการ์ด — ชุดคำเดียวกับป้ายบนบอร์ดงาน (PM / อัตโนมัติ) ให้รู้ว่าเป็นใบอะไรโดยไม่ต้องกดเข้าไป
 * ใบรอบ PM ที่ CEO รวบหลายรอบ = autoCreated แต่มีคนเปิด (CEO) ⇒ "CEO รวบ" ไม่ใช่ "อัตโนมัติ"
 */
function workOrderTags(
  wo: { pmScheduleId: string | null; pmScheduleIds: string[]; autoCreated: boolean; createdBy: string | null } | null,
): string[] {
  if (!wo) return [];
  const tags: string[] = [];
  if (wo.pmScheduleId || wo.pmScheduleIds.length > 0) tags.push("PM");
  if (wo.autoCreated) tags.push(wo.createdBy ? "CEO รวบ" : "อัตโนมัติ");
  return tags;
}

/** ป้ายของการ์ดงาน: Task เสมอ · งานในโปรเจกต์ / งานย่อย บอกเพิ่ม */
/**
 * งานในโปรเจกต์ → ชื่อโปรเจกต์ + ช่วงงาน ใส่ในการ์ด · ตอนสร้างโปรเจกต์ ตัวโปรเจกต์กับงานบันทึกคนละจังหวะ
 * อ่านไม่เจอรอบแรกรอแป๊บแล้วอ่านอีกรอบ · ไม่เจอ/พลาด = การ์ดไม่มีบรรทัดโปรเจกต์ (ป้าย "โปรเจกต์" ยังอยู่)
 */
async function projectOf(orgId: string, task: { data: unknown } | null): Promise<{ project?: ChatTaskCard["project"] }> {
  const data = task?.data && typeof task.data === "object" ? (task.data as Record<string, unknown>) : null;
  const link = data?.project && typeof data.project === "object" ? (data.project as Record<string, unknown>) : null;
  const projectId = typeof link?.projectId === "string" ? link.projectId : "";
  if (!projectId) return {};
  type P = { id?: string; name?: string; sections?: { id?: string; name?: string }[] };
  const find = async () => {
    const { data: list } = await readStore<P[]>(orgId, "projects").catch(() => ({ data: null }));
    return Array.isArray(list) ? list.find((x) => x?.id === projectId) : undefined;
  };
  try {
    let p = await find();
    if (!p) {
      await new Promise((r) => setTimeout(r, 2500));
      p = await find();
    }
    if (!p || typeof p.name !== "string") return {};
    const section = p.sections?.find((s) => s?.id === link?.sectionId)?.name;
    return { project: { id: projectId, name: p.name, ...(typeof section === "string" && section ? { section } : {}) } };
  } catch {
    return {};
  }
}

async function assigneeNames(orgId: string, ids: string[]): Promise<{ assignees?: string[] }> {
  if (!ids.length) return {};
  const rows = await prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }).catch(() => []);
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  const names = ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
  return names.length ? { assignees: names } : {};
}

function isProjectTask(task: { data: unknown } | null): boolean {
  const data = task?.data && typeof task.data === "object" ? (task.data as Record<string, unknown>) : null;
  const link = data?.project && typeof data.project === "object" ? (data.project as Record<string, unknown>) : null;
  return typeof link?.projectId === "string" && !!link.projectId;
}

function taskTags(task: { parentId: string | null; data: unknown } | null): string[] {
  const tags = ["Task"];
  const data = task?.data && typeof task.data === "object" ? (task.data as Record<string, unknown>) : null;
  const project = data?.project && typeof data.project === "object" ? (data.project as Record<string, unknown>) : null;
  if (project && typeof project.projectId === "string" && project.projectId) tags.push("โปรเจกต์");
  if (task?.parentId) tags.push("งานย่อย");
  return tags;
}
