"use server";

/**
 * แก้ทีมหลังสร้างใบ + เช็กลิสต์ใบแจ้งซ่อม (ผู้ใช้ 5/11/2569 "แก้ทีเดียวไปเลย ... ทำออกมาให้ชัดเจน")
 *
 * แก้ทีม — คนแก้ได้: คนเปิดใบ (ใบ PM อัตโนมัติ = คนสร้างแผน) และผู้ดูทั้งหมด/CEO เหมือนแก้กำหนดส่ง
 *  - เพิ่มคน: ได้แจ้งเตือน + การ์ดในแชท · ถ้าใบเลยกำหนดแล้วต้องตั้งวันส่งของคนใหม่ ไม่งั้นโดนหักทันที
 *  - เอาคนออก: คะแนนที่หักไปแล้วคงไว้ (removedMemberIds) — กันเอาคนสายออกเพื่อล้างคะแนน
 *  - เปลี่ยนเดี่ยว/กลุ่ม หรือวิธีปิดงาน: ได้เฉพาะตอนยังไม่มีใครกดเสร็จ
 *
 * เช็กลิสต์ — กติกาใน modules/maintenance/lib/work-order-checklist.ts (เหมือนงาน)
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@smartboss/database";
import { requireOrg, hasPermission, canViewAll } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { getWorkOrder, addWorkOrderComment, workOrderOwnerId } from "@/modules/maintenance/data/work-orders";
import { workOrderAccess, canSeeWorkOrder } from "@/modules/maintenance/data/work-order-access";
import { notifyUser } from "@/modules/maintenance/data/notify";
import { userNameMap } from "@/modules/maintenance/data/users";
import { postWorkOrderCard } from "@/modules/chat/data/task-cards";
import { logActivity } from "@/modules/maintenance/data/activity";
import { canEditDueDate } from "@/modules/maintenance/lib/due-request-access";
import { isPastDay } from "@/modules/maintenance/lib/no-past-date";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { COMPLETION_RULE_LABEL, isWorkOrderMember, memberDueAt, workOrderMemberIds } from "@/modules/maintenance/lib/work-order-members";
import {
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_MAX_TEXT,
  canTickItem,
  deriveCompletedMembers,
  fitChecklist,
  fitOwner,
  readChecklist,
  type WoChecklistItem,
} from "@/modules/maintenance/lib/work-order-checklist";

type Result = { error?: string };
type Session = Awaited<ReturnType<typeof requireOrg>>;
type Wo = NonNullable<Awaited<ReturnType<typeof getWorkOrder>>>;

const isOpen = (wo: Wo) => wo.status === "open" || wo.status === "in_progress";

async function loadOpen(s: Session, id: string): Promise<Wo | string> {
  const wo = await getWorkOrder(s.orgId, id);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return "ไม่พบใบงานนี้";
  if (!isOpen(wo)) return "ใบงานปิดหรือยกเลิกแล้ว แก้ไม่ได้";
  return wo;
}

/** คนแก้ทีมและจัดการเช็กลิสต์ทั้งใบได้ — เงื่อนไขเดียวกับแก้กำหนดส่ง */
async function canEditTeam(s: Session, wo: Wo): Promise<boolean> {
  return canEditDueDate({ userId: s.userId, viewAll: canViewAll(s) }, { createdBy: await workOrderOwnerId(s.orgId, wo) });
}

function done(id: string) {
  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

/** ใครเสร็จแล้วหลังเช็กลิสต์/ทีมเปลี่ยน — ใบเดี่ยวไม่ใช้ completedMemberIds (ปิดงานคือเสร็จ) */
function completedAfter(wo: Pick<Wo, "assignedTo" | "groupMemberIds" | "completionRule">, items: WoChecklistItem[], manual: string[]): string[] {
  if (wo.groupMemberIds.length === 0) return [];
  return deriveCompletedMembers(wo, items, manual);
}

export async function updateWorkOrderTeamAction(formData: FormData): Promise<Result> {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const loaded = await loadOpen(s, id);
  if (typeof loaded === "string") return { error: loaded };
  const wo = loaded;
  if (wo.isPrivate) return { error: "ใบส่วนตัวแก้ผู้รับผิดชอบไม่ได้" };
  if (!(await canEditTeam(s, wo))) return { error: "แก้ผู้รับผิดชอบได้เฉพาะคนเปิดใบหรือผู้ดูแล" };

  const assignedTo = String(formData.get("assignedTo") ?? "");
  if (!assignedTo) return { error: "เลือกผู้รับผิดชอบก่อน" };
  const wantGroup = formData.get("woMode") === "group";
  const picked = wantGroup ? [...new Set(formData.getAll("groupMemberIds").map(String).filter((x) => x && x !== assignedTo))] : [];
  const valid = new Set(
    (await prisma.user.findMany({ where: { orgId: s.orgId, isActive: true, id: { in: [assignedTo, ...picked] } }, select: { id: true } })).map((u) => u.id),
  );
  if (!valid.has(assignedTo)) return { error: "ผู้รับผิดชอบไม่อยู่ในบริษัทแล้ว" };
  const groupMemberIds = picked.filter((x) => valid.has(x));
  const pickedRule = String(formData.get("completionRule") ?? "all");
  const completionRule = groupMemberIds.length > 0 ? (["all", "any", "shared"].includes(pickedRule) ? pickedRule : "all") : null;

  const wasGroup = wo.groupMemberIds.length > 0;
  const isGroupNow = groupMemberIds.length > 0;
  const someoneDone = wo.completedMemberIds.length > 0;
  if (someoneDone && (wasGroup !== isGroupNow || (wo.completionRule ?? "all") !== (completionRule ?? "all"))) {
    return { error: "มีคนกดเสร็จไปแล้ว เปลี่ยนเดี่ยว/กลุ่มหรือวิธีปิดงานไม่ได้ — เพิ่มหรือเอาคนออกได้" };
  }

  // กำหนดส่งรายคน — วันเดิมที่ผ่านไปแล้วเก็บไว้ได้ วันใหม่ย้อนหลังไม่ได้
  const before = (wo.memberDueDates ?? {}) as Record<string, string>;
  const memberDueDates: Record<string, string> = {};
  if (isGroupNow) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(String(formData.get("memberDueDates") ?? "null"));
    } catch {
      raw = null;
    }
    for (const [uid, day] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
      if (uid !== assignedTo && !groupMemberIds.includes(uid)) continue;
      if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (isPastDay(day) && before[uid] !== day) return { error: "กำหนดส่งรายคนย้อนหลังไม่ได้" };
      memberDueDates[uid] = day;
    }
  }

  const oldMembers = workOrderMemberIds(wo);
  const next = { ...wo, assignedTo, groupMemberIds, completionRule, memberDueDates: isGroupNow ? memberDueDates : null };
  const newMembers = workOrderMemberIds(next);
  const added = newMembers.filter((x) => !oldMembers.includes(x));
  const removed = oldMembers.filter((x) => !newMembers.includes(x));
  if (added.length === 0 && removed.length === 0 && wasGroup === isGroupNow && (wo.completionRule ?? null) === completionRule && JSON.stringify(before) === JSON.stringify(isGroupNow ? memberDueDates : {})) {
    return {};
  }

  // คนที่เพิ่มเข้ามาตอนใบเลยกำหนดแล้ว ต้องมีวันส่งของตัวเอง — ไม่งั้นคืนนี้โดนหักทั้งที่เพิ่งได้งาน
  const names = await userNameMap(s.orgId, [...newMembers, ...removed]);
  for (const uid of added) {
    const due = memberDueAt(next, uid);
    if (due && due.getTime() < Date.now()) {
      return {
        error: isGroupNow
          ? `ใบนี้เลยกำหนดแล้ว ตั้งกำหนดส่งของ ${names[uid] ?? "คนที่เพิ่ม"} ใน "กำหนดส่งแยกรายคน" ก่อน`
          : "ใบนี้เลยกำหนดแล้ว เลื่อนกำหนดส่งก่อนแล้วค่อยเปลี่ยนคน",
      };
    }
  }

  const items = fitChecklist(readChecklist(wo.checklist), next);
  const manual = wo.completedMemberIds.filter((x) => newMembers.includes(x));
  const removedMemberIds = [...new Set([...wo.removedMemberIds, ...removed])].filter((x) => !newMembers.includes(x));
  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      assignedTo,
      groupMemberIds,
      completionRule,
      memberDueDates: isGroupNow && Object.keys(memberDueDates).length > 0 ? memberDueDates : Prisma.DbNull,
      completedMemberIds: completedAfter(next, items, manual),
      removedMemberIds,
      ...(items.length > 0 ? { checklist: items as unknown as Prisma.InputJsonValue } : {}),
      // คนที่ถูกเพิ่มเป็น CC อยู่ก่อน ไม่ต้องซ้ำ
      ccUserIds: wo.ccUserIds.filter((x) => !newMembers.includes(x)),
    },
  });

  const parts = [
    added.length ? `เพิ่ม ${added.map((x) => names[x] ?? "-").join(", ")}` : "",
    removed.length ? `เอาออก ${removed.map((x) => names[x] ?? "-").join(", ")}` : "",
    wasGroup !== isGroupNow ? (isGroupNow ? "เปลี่ยนเป็นใบกลุ่ม" : "เปลี่ยนเป็นใบเดี่ยว") : "",
    isGroupNow && (wo.completionRule ?? null) !== completionRule ? `ปิดงานเมื่อ${COMPLETION_RULE_LABEL[completionRule!]}` : "",
    isGroupNow && JSON.stringify(before) !== JSON.stringify(memberDueDates) ? "แก้กำหนดส่งรายคน" : "",
  ].filter(Boolean);
  await addWorkOrderComment(s.orgId, wo.id, s.userId, `แก้ผู้รับผิดชอบ: ${parts.join(" · ") || "ไม่เปลี่ยน"}`, null, { kind: "log" });
  await logActivity(s.orgId, {
    userId: s.userId,
    entity: "work_order",
    entityId: wo.id,
    entityCode: wo.code,
    action: "update",
    summary: `แก้ผู้รับผิดชอบ ${wo.code ?? ""} "${wo.title}"`.replace(/\s+/g, " ").trim(),
    detail: { added, removed, groupMemberIds, completionRule },
  });

  for (const uid of added) {
    const due = memberDueAt(next, uid);
    await notifyUser(s.orgId, uid, {
      title: `📋 ได้รับมอบหมายงานใหม่: ${wo.title}`,
      body: [due ? `ครบกำหนด ${fmtThaiDate(due)}` : null, wo.description ?? null].filter(Boolean).join("\n") || undefined,
      type: "work_order",
      referenceId: wo.id,
      line: `📢 งานใหม่: ${wo.title}\n${due ? `📅 ครบกำหนด ${fmtThaiDate(due)}\n` : ""}เข้าดูรายละเอียดในระบบ`,
    });
    await postWorkOrderCard(s.orgId, { assignerId: s.userId, assigneeId: uid, workOrderId: wo.id, title: wo.title, dueDate: due });
  }
  for (const uid of removed) {
    await notifyUser(s.orgId, uid, {
      title: `ถอดคุณออกจากใบงาน: ${wo.title}`,
      body: `${wo.code ?? ""} · ไม่ต้องทำใบนี้แล้ว`.trim(),
      type: "work_order",
      referenceId: wo.id,
    });
  }
  done(wo.id);
  return {};
}

// ───────────────────────── เช็กลิสต์ ─────────────────────────

async function saveChecklist(s: Session, wo: Wo, items: WoChecklistItem[], log: string) {
  const fitted = fitChecklist(items, wo);
  const completedMemberIds = completedAfter(wo, fitted, wo.completedMemberIds);
  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      checklist: fitted.length > 0 ? (fitted as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      completedMemberIds,
    },
  });
  if (log) await addWorkOrderComment(s.orgId, wo.id, s.userId, log, null, { kind: "log" });

  // ครบทุกคน: เหลือคนเดียวที่ยังไม่เสร็จ ⇒ บอกคนนั้นให้ปิดงาน (เหมือนปุ่มเสร็จส่วนของฉัน)
  const members = workOrderMemberIds(wo);
  if (wo.groupMemberIds.length > 0 && (wo.completionRule ?? "all") === "all") {
    const left = members.filter((x) => !completedMemberIds.includes(x));
    const wasLeft = members.filter((x) => !wo.completedMemberIds.includes(x));
    if (left.length === 1 && wasLeft.length > 1 && left[0] !== s.userId) {
      await notifyUser(s.orgId, left[0]!, {
        title: `✅ ทุกคนเสร็จแล้ว เหลือคุณคนเดียว: ${wo.title}`,
        body: `${wo.code} · ทำส่วนของคุณให้เสร็จแล้วกดปิดงาน`,
        type: "work_order",
        referenceId: wo.id,
      });
    }
  }
  done(wo.id);
}

export async function toggleChecklistItemAction(workOrderId: string, itemId: string): Promise<Result> {
  const s = await requireOrg();
  const loaded = await loadOpen(s, workOrderId);
  if (typeof loaded === "string") return { error: loaded };
  const wo = loaded;
  if (!hasPermission(s, MAINT_PERMS.workorderComplete) && !hasPermission(s, MAINT_PERMS.workorderManage)) {
    return { error: "ไม่มีสิทธิ์ติ๊กเช็กลิสต์" };
  }
  const items = readChecklist(wo.checklist);
  const item = items.find((c) => c.id === itemId);
  if (!item) return { error: "ไม่พบข้อนี้ — โหลดหน้าใหม่" };
  if (!canTickItem(item, s.userId, wo, canViewAll(s))) return { error: "ติ๊กได้เฉพาะข้อของตัวเอง" };
  const nowDone = !item.done;
  const next = items.map((c) =>
    c.id === itemId ? { ...c, done: nowDone, doneBy: nowDone ? s.userId : null, doneAt: nowDone ? new Date().toISOString() : null } : c,
  );
  await saveChecklist(s, wo, next, "");
  return {};
}

export async function addChecklistItemAction(workOrderId: string, text: string, ownerId: string | null): Promise<Result> {
  const s = await requireOrg();
  const loaded = await loadOpen(s, workOrderId);
  if (typeof loaded === "string") return { error: loaded };
  const wo = loaded;
  const clean = text.trim().slice(0, CHECKLIST_MAX_TEXT);
  if (!clean) return { error: "พิมพ์ข้อความก่อน" };
  const editor = await canEditTeam(s, wo);
  // เช็กลิสต์กำหนดโดยคนเปิดใบ (หรือ CEO/ผู้ดูแล) เท่านั้น — ผู้รับงานติ๊กได้อย่างเดียว (IS-0009 ผู้ใช้ 8/11/2569)
  if (!editor) return { error: "เพิ่มเช็กลิสต์ได้เฉพาะคนเปิดใบงาน — แจ้งคนเปิดใบให้เพิ่มให้" };
  const owner = fitOwner(ownerId, wo);
  const items = readChecklist(wo.checklist);
  if (items.length >= CHECKLIST_MAX_ITEMS) return { error: `เช็กลิสต์ได้สูงสุด ${CHECKLIST_MAX_ITEMS} ข้อ` };
  await saveChecklist(s, wo, [...items, { id: randomUUID(), text: clean, done: false, ownerId: owner }], `เพิ่มเช็กลิสต์: ${clean}`);
  return {};
}

export async function removeChecklistItemAction(workOrderId: string, itemId: string): Promise<Result> {
  const s = await requireOrg();
  const loaded = await loadOpen(s, workOrderId);
  if (typeof loaded === "string") return { error: loaded };
  const wo = loaded;
  const items = readChecklist(wo.checklist);
  const item = items.find((c) => c.id === itemId);
  if (!item) return {};
  const editor = await canEditTeam(s, wo);
  // ลบได้เฉพาะคนเปิดใบ (หรือ CEO/ผู้ดูแล) — IS-0009
  if (!editor) return { error: "ลบเช็กลิสต์ได้เฉพาะคนเปิดใบงาน" };
  await saveChecklist(s, wo, items.filter((c) => c.id !== itemId), `ลบเช็กลิสต์: ${item.text}`);
  return {};
}
