/**
 * เช็กลิสต์ใบแจ้งซ่อม (ผู้ใช้ 5/11/2569 "เอาให้เหมือน task เลย") — กติกาเดียวกับงาน
 * (modules/report_task/lib/task-completion.ts):
 *
 *  - ใบเดี่ยว: ทุกข้อเป็นของผู้รับผิดชอบ ติ๊กครบ = ปิดงานได้
 *  - กลุ่ม · ครบทุกคน / คนใดคนหนึ่ง: แต่ละข้อมีเจ้าของ คนติ๊กข้อของตัวเองครบ = ส่วนของคนนั้นเสร็จ
 *    คนที่ไม่มีข้อของตัวเอง กด "เสร็จส่วนของฉันแล้ว" แทน
 *  - กลุ่ม · ช่วยกันทำ: ข้อไม่แยกคน ใครในกลุ่มติ๊กข้อไหนก็ได้ ครบทุกข้อ = ทุกคนเสร็จ
 *  - ไม่มีเช็กลิสต์ (null / ว่าง) = ปิดงานแบบเดิมทุกอย่าง
 *
 * ติ๊กได้: เจ้าของข้อ · ช่วยกันทำ = ทุกคนในกลุ่ม · CEO/ผู้ดูทั้งหมด ติ๊กแทนได้ (ตรวจแก้ได้เหมือนงาน)
 */
import { workOrderMemberIds } from "@/modules/maintenance/lib/work-order-members";

export interface WoChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** null = ช่วยกันทำ (ไม่แยกคน) */
  ownerId: string | null;
  doneBy?: string | null;
  doneAt?: string | null;
}

/** แม่แบบในแผน PM — ยังไม่มีสถานะติ๊ก */
export interface WoChecklistTemplateItem {
  text: string;
  ownerId: string | null;
}

export const CHECKLIST_MAX_ITEMS = 40;
export const CHECKLIST_MAX_TEXT = 200;

type Team = { assignedTo: string | null; groupMemberIds?: string[] | null; completionRule?: string | null };

function isGroup(wo: Team): boolean {
  return (wo.groupMemberIds ?? []).length > 0;
}

function ruleOf(wo: Team): "all" | "any" | "shared" {
  const r = wo.completionRule ?? "all";
  return r === "any" || r === "shared" ? r : "all";
}

export function readChecklist(raw: unknown): WoChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: String(x.id ?? ""),
      text: String(x.text ?? ""),
      done: x.done === true,
      ownerId: typeof x.ownerId === "string" && x.ownerId ? x.ownerId : null,
      doneBy: typeof x.doneBy === "string" ? x.doneBy : null,
      doneAt: typeof x.doneAt === "string" ? x.doneAt : null,
    }))
    .filter((x) => x.id && x.text);
}

export function readChecklistTemplate(raw: unknown): WoChecklistTemplateItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      text: String(x.text ?? "").trim().slice(0, CHECKLIST_MAX_TEXT),
      ownerId: typeof x.ownerId === "string" && x.ownerId ? x.ownerId : null,
    }))
    .filter((x) => x.text)
    .slice(0, CHECKLIST_MAX_ITEMS);
}

/**
 * เจ้าของข้อให้ตรงกับทีมตอนนี้ — ใบเดี่ยว: ผู้รับผิดชอบ · ช่วยกันทำ: ไม่มีเจ้าของ ·
 * แบบอื่น: เจ้าของต้องอยู่ในกลุ่ม ไม่งั้น (ถูกถอดออก / ไม่ได้เลือก) ตกเป็นของผู้รับผิดชอบหลัก
 */
export function fitOwner(ownerId: string | null, wo: Team): string | null {
  if (!isGroup(wo)) return wo.assignedTo;
  if (ruleOf(wo) === "shared") return null;
  const members = workOrderMemberIds(wo);
  return ownerId && members.includes(ownerId) ? ownerId : wo.assignedTo;
}

export function fitChecklist(items: WoChecklistItem[], wo: Team): WoChecklistItem[] {
  return items.map((c) => ({ ...c, ownerId: fitOwner(c.ownerId, wo) }));
}

/** แม่แบบ → รายการจริงของใบใหม่ (ทุกข้อยังไม่ติ๊ก) */
export function checklistFromTemplate(template: WoChecklistTemplateItem[], wo: Team, newId: () => string): WoChecklistItem[] {
  return template.map((t) => ({ id: newId(), text: t.text, done: false, ownerId: fitOwner(t.ownerId, wo) }));
}

/** ข้อที่คนนี้ต้องทำ — ช่วยกันทำ = ทุกข้อ */
export function itemsOf(items: WoChecklistItem[], userId: string, wo: Team): WoChecklistItem[] {
  if (isGroup(wo) && ruleOf(wo) === "shared") return items;
  return items.filter((c) => c.ownerId === userId);
}

/**
 * ใครทำส่วนของตัวเองเสร็จแล้ว — คนที่มีข้อของตัวเอง: ติ๊กครบ · คนที่ไม่มีข้อ: ตามที่กดเองไว้ (manual)
 * ช่วยกันทำ: ครบทุกข้อ = ทุกคนเสร็จพร้อมกัน
 */
export function deriveCompletedMembers(wo: Team, items: WoChecklistItem[], manual: string[]): string[] {
  const members = workOrderMemberIds(wo);
  if (items.length === 0) return members.filter((id) => manual.includes(id));
  if (isGroup(wo) && ruleOf(wo) === "shared") return items.every((c) => c.done) ? members : [];
  return members.filter((id) => {
    const mine = items.filter((c) => c.ownerId === id);
    return mine.length === 0 ? manual.includes(id) : mine.every((c) => c.done);
  });
}

/**
 * เช็กลิสต์อนุญาตให้ปิดงานไหม — ไม่มีเช็กลิสต์ = ได้เสมอ (ปิดแบบเดิม)
 * ใบเดี่ยว / ช่วยกันทำ: ครบทุกข้อ · ครบทุกคน: ทุกข้อที่มีเจ้าของครบ · คนใดคนหนึ่ง: มีคนหนึ่งที่ข้อของตัวเองครบ
 */
export function checklistAllowsClose(wo: Team, items: WoChecklistItem[]): boolean {
  if (items.length === 0) return true;
  if (!isGroup(wo) || ruleOf(wo) !== "any") return items.every((c) => c.done);
  return workOrderMemberIds(wo).some((id) => {
    const mine = items.filter((c) => c.ownerId === id);
    return mine.length > 0 && mine.every((c) => c.done);
  });
}

export function remainingCount(items: WoChecklistItem[]): number {
  return items.filter((c) => !c.done).length;
}

/** ติ๊ก/เอาติ๊กออกได้ไหม — เจ้าของข้อ · ช่วยกันทำ = ทุกคนในกลุ่ม · CEO/ผู้ดูทั้งหมด */
export function canTickItem(item: WoChecklistItem, userId: string, wo: Team, override: boolean): boolean {
  if (override) return true;
  if (isGroup(wo) && ruleOf(wo) === "shared") return workOrderMemberIds(wo).includes(userId);
  return item.ownerId === userId;
}
