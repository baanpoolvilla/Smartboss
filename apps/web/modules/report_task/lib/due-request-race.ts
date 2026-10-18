import type { Task } from "@/modules/report_task/types";

/**
 * คำขอเลื่อนกำหนดส่งที่ "ตัดสินชนกัน" — 2 คน (เช่น CEO กับหัวหน้าแผนก) กดอนุมัติ/ไม่อนุมัติคำขอเดียวกัน
 * แทบพร้อมกันจากคนละเครื่อง (ผู้ใช้เลือกแบบนี้ 18/10/2569 "ใครกดก่อนได้ก่อน"):
 * ตอนบันทึกชน (409) แล้ว merge — ถ้าเซิร์ฟเวอร์มีคำตัดสินของคนแรกอยู่แล้ว ใช้ของคนแรกทั้งงาน
 * (สถานะคำขอ + วันส่ง + ประวัติ) ทิ้งคำตัดสินของเรา · เดิม merge ให้คนบันทึกทีหลังชนะในช่องสถานะ
 * แต่วันส่งเลื่อนตามคนแรกไปแล้ว ⇒ "ไม่อนุมัติ" ทั้งที่วันถูกเลื่อน (ข้อมูลขัดกันเอง)
 *
 * base = ที่เซิร์ฟเวอร์มีตอนเราเห็นล่าสุด · mine = ของเรา · theirs = ที่เซิร์ฟเวอร์มีตอนนี้ · merged = ผล mergeThreeWay
 */
export interface LostDecision {
  taskId: string;
  taskTitle: string;
  requestedBy: string;
  /** คำตัดสินที่ชนะ (คนแรก) */
  winner: { status: string; decidedBy?: string };
  /** คำตัดสินของเราที่ไม่ถูกบันทึก */
  mine: string;
}

export function resolveDueRequestRaces(
  base: Task[] | null,
  mine: Task[],
  theirs: Task[],
  merged: Task[]
): { tasks: Task[]; lost: LostDecision[] } {
  if (!base) return { tasks: merged, lost: [] };
  const baseById = new Map(base.map((t) => [t.id, t]));
  const mineById = new Map(mine.map((t) => [t.id, t]));
  const theirsById = new Map(theirs.map((t) => [t.id, t]));
  const lost: LostDecision[] = [];
  const replace = new Map<string, Task>();

  for (const [id, myTask] of mineById) {
    const baseTask = baseById.get(id);
    const theirTask = theirsById.get(id);
    if (!baseTask || !theirTask) continue;
    for (const myReq of myTask.dueDateRequests ?? []) {
      const baseReq = (baseTask.dueDateRequests ?? []).find((r) => r.id === myReq.id);
      const theirReq = (theirTask.dueDateRequests ?? []).find((r) => r.id === myReq.id);
      if (!baseReq || !theirReq || baseReq.status !== "pending") continue;
      // ทั้งเราและอีกคนตัดสินคำขอเดียวกันจากสถานะ "รอ" — คนที่บันทึกถึงเซิร์ฟเวอร์ก่อน (theirs) ชนะ
      if (myReq.status !== "pending" && theirReq.status !== "pending") {
        replace.set(id, theirTask);
        if (myReq.status !== theirReq.status || myReq.decidedBy !== theirReq.decidedBy) {
          lost.push({
            taskId: id,
            taskTitle: myTask.title,
            requestedBy: myReq.requestedBy,
            winner: { status: theirReq.status, decidedBy: theirReq.decidedBy },
            mine: myReq.status,
          });
        }
      }
    }
  }
  if (!replace.size) return { tasks: merged, lost };
  return { tasks: merged.map((t) => replace.get(t.id) ?? t), lost };
}
