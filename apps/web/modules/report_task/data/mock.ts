import type {
  ActivityItem,
  Attachment,
  CalendarEvent,
  ChecklistItem,
  Comment,
  Department,
  RevisionEntry,
  Task,
  TaskPriority,
  TaskReaction,
  TaskStatus,
  User,
} from "@/modules/report_task/types";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { deriveCompletedAssigneeIds } from "@/modules/report_task/lib/task-completion";

// Deterministic seeded PRNG so server and client render identical mock data.
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260716);
// อาร์เรย์ที่ส่งเข้ามาเป็นค่าคงที่ในไฟล์นี้ ไม่มีทางว่าง
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] as T;
const pickN = <T,>(arr: T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0] as T);
  }
  return out;
};
const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};
const iso = (d: Date) => d.toISOString();
// Anchored to the real current date (not a hardcoded one) so freshly-seeded
// demo data — due dates, "overdue" status, activity timestamps — stays
// realistic no matter when this seed actually runs, instead of drifting
// further into the past (and more tasks silently flipping to "overdue")
// with every day that passes since this file was last touched. Only used to
// seed `data/tasks/*.json` on first boot (see lib/db/tasks-repo.ts) — not
// re-evaluated per request, so there's no server/client hydration mismatch
// to worry about from using a live date here.
const today = new Date();
today.setHours(9, 0, 0, 0);

// `departments`/`users` are live views over useDepartmentStore/useEmployeeStore
// (the real, owner-editable, server-persisted org data — see
// src/components/shared/org-settings-panel.tsx), not static data. A Proxy
// forwards every array access (`.map`, `.find`, `.some`, `.length`, ...) to
// `.getState()` on each read, so every one of this file's own helpers below
// (getUser, getDepartment, isDepartmentHead, departmentIdsOf, ...) plus every
// other file in the app that already does `departments.map(...)` /
// `users.find(...)` keeps working unchanged and always sees current data —
// no refactor needed at any of those call sites. The one thing this does
// NOT do is force a React re-render purely because the store changed
// elsewhere; components that need that (the org settings panel, the
// identity switcher) read the store's hook directly instead.
function liveArrayProxy<T>(getLive: () => T[]): T[] {
  return new Proxy([] as T[], {
    get: (_target, prop, receiver) => Reflect.get(getLive(), prop, receiver),
    // `map`/`filter`/`some`/`forEach`/etc. all call HasProperty on each index
    // before reading it (to skip holes in sparse arrays) — without this trap
    // that check falls through to the permanently-empty dummy target, so
    // every index reads as "missing" and those methods silently no-op.
    has: (_target, prop) => Reflect.has(getLive(), prop),
  });
}

export const departments: Department[] = liveArrayProxy(() => useDepartmentStore.getState().departments);
export const users: User[] = liveArrayProxy(() => useEmployeeStore.getState().employees);

const taskTitles = [
  "ออกแบบขั้นตอนออนบอร์ดใหม่", "แก้บั๊กระบบชำระเงินหน้าเช็คเอาต์", "เพิ่มปุ่มสลับโหมดมืด",
  "ย้ายฐานข้อมูลไปสคีมา v2", "เขียนคอนเทนต์การตลาดไตรมาส 3", "ตั้งค่า CI/CD pipeline",
  "ออกแบบ Hero หน้า Landing Page ใหม่", "ปรับปรุงความเร็วในการตอบสนองของ API", "จัดทำสไลด์สนับสนุนทีมขาย",
  "ตรวจสอบมาตรฐานการเข้าถึง (Accessibility)", "สร้างศูนย์การแจ้งเตือน", "ร่างสัญญาพันธมิตรทางธุรกิจ",
  "ปรับโครงสร้างคอมโพเนนต์รายการงาน", "วางแผนจัดเวบินาร์ลูกค้า", "อัปเดตคู่มือพนักงาน",
  "ตรวจสอบสาเหตุอัตราลูกค้าเลิกใช้พุ่งสูง", "แปลแอปให้รองรับตลาดไทย", "สร้างแดชบอร์ดวิเคราะห์ข้อมูล",
  "ตรวจสอบสัญญาผู้ให้บริการ", "เตรียมรายงานอัปเดตนักลงทุน", "แก้ไขเมนูมือถือซ้อนทับ",
  "ตั้งค่าเฟรมเวิร์กทดสอบ A/B", "ปรับปรุงอัตราการส่งอีเมลถึงกล่องจดหมาย", "จัดทำคู่มือแบรนด์เวอร์ชัน 2",
  "รวบรวมชุดคำตอบสำเร็จรูปฝ่ายซัพพอร์ต", "ทำระบบออกใบแจ้งหนี้อัตโนมัติ", "ทดสอบโหลดเซิร์ฟเวอร์จริง",
  "ออกแบบหน้าจอ Empty State ของแอป", "เขียนเอกสารประกอบ API", "วางแผนโลจิสติกส์ย้ายออฟฟิศ",
  "เปิดใช้ฟิลด์ใหม่ในระบบ CRM", "แก้บั๊กเขตเวลาในปฏิทิน", "จัดทำตัวติดตาม OKR ไตรมาส 3",
  "สัมภาษณ์ผู้สมัครตำแหน่ง PM", "เชื่อมต่อระบบ SSO", "ปรับปรุงความแม่นยำของการค้นหา",
  "ออกแบบหน้าราคาใหม่", "ประสานงานบูธงานแสดงสินค้า", "แก้ไขรูปแบบไฟล์ CSV ที่ส่งออก",
  "สร้างระบบแนะนำเพื่อน", "อัปเดตนโยบายความเป็นส่วนตัว", "ปรับปรุงกระบวนการจัดการรูปภาพ",
  "จัดทำคู่มือ Customer Success", "ตรวจสอบผลประกอบการไตรมาส 2", "จัดตารางเวรออนคอล",
  "ออกแบบไอคอนแอปมือถือ", "วางแผนทริปทีมปลายปี", "แก้ไขข้อมูลลีดที่ซ้ำซ้อน",
  "เขียนบันทึกการอัปเดตเวอร์ชัน 4.2", "สร้างระบบจำกัดอัตราการเรียก API ภายใน",
];

const statuses: TaskStatus[] = ["todo", "in_progress", "done"];
const priorities: TaskPriority[] = ["critical", "high", "medium", "low"];

function makeAttachments(taskId: string, n: number, authorId: string): Attachment[] {
  const fileTypes = [
    { ext: "pdf", type: "PDF" }, { ext: "png", type: "รูปภาพ" }, { ext: "xlsx", type: "สเปรดชีต" }, { ext: "docx", type: "เอกสาร" },
  ];
  return Array.from({ length: n }).map((_, i) => {
    const f = pick(fileTypes);
    return {
      id: `${taskId}-att-${i}`,
      name: `${taskId}-file-${i + 1}.${f.ext}`,
      size: `${(rand() * 4 + 0.2).toFixed(1)} MB`,
      type: f.type,
      uploadedBy: authorId,
      uploadedAt: iso(addDays(today, -Math.floor(rand() * 20))),
    };
  });
}

function makeComments(taskId: string, n: number): Comment[] {
  const msgs = [
    "เริ่มทำแล้ว จะอัปเดตความคืบหน้าภายในวันนี้",
    "ติดขัดที่รอรีวิวดีไซน์ แจ้งหัวหน้าแล้ว",
    "ส่งฉบับร่างแรกแล้ว ช่วยดูให้หน่อย",
    "ต้องปรับอีกรอบก่อนพร้อมใช้งาน",
    "ดูดีแล้ว อนุมัติ",
    "ขอเลื่อนกำหนดส่งอีกหนึ่งวันได้ไหม",
    "อัปเดตตามฟีดแบ็กจากที่ประชุม standup แล้ว",
  ];
  return Array.from({ length: n }).map((_, i) => ({
    id: `${taskId}-cmt-${i}`,
    authorId: pick(users).id,
    message: pick(msgs),
    createdAt: iso(addDays(today, -Math.floor(rand() * 15))),
  }));
}

function makeRevisions(taskId: string, n: number, originalDate: Date): { revisions: RevisionEntry[]; finalDate: Date } {
  const revisions: RevisionEntry[] = [];
  let prev = originalDate;
  for (let i = 0; i < n; i++) {
    const next = addDays(prev, Math.floor(rand() * 5) + 2);
    revisions.push({
      revisionNumber: i + 1,
      previousDate: iso(prev),
      newDate: iso(next),
      reason: pick([
        "ขอบเขตงานเพิ่มขึ้นหลังได้ฟีดแบ็กจากลูกค้า",
        "รอความคืบหน้าจากทีมอื่นที่เกี่ยวข้อง",
        "ทรัพยากรชนกัน ต้องจัดลำดับความสำคัญใหม่",
        "ต้องเพิ่มรอบทดสอบ QA",
        "ผู้มีส่วนได้ส่วนเสียขอให้ปรับแก้",
      ]),
      revisedBy: pick(users).id,
      revisedAt: iso(addDays(prev, 1)),
    });
    prev = next;
  }
  return { revisions, finalDate: prev };
}

function departmentHead(departmentId: string) {
  const dept = departments.find((d) => d.id === departmentId);
  return dept ? dept.headId : users[0]!.id;
}

const checklistPool = [
  "รวบรวมความต้องการจากผู้เกี่ยวข้อง",
  "ร่างแนวทาง / ออกแบบเบื้องต้น",
  "ให้หัวหน้ารีวิว",
  "ลงมือทำจริง",
  "ทดสอบและตรวจความถูกต้อง",
  "อัปเดตเอกสาร",
  "แจ้งทีมที่เกี่ยวข้อง",
];

function makeChecklist(taskId: string, n: number, allDone: boolean, ownerId: string): ChecklistItem[] {
  return pickN(checklistPool, n).map((text, i) => ({
    id: `${taskId}-chk-${i}`,
    text,
    done: allDone || rand() < 0.4,
    ownerId,
  }));
}

function makeReactions(taskId: string, assigneeId: string, departmentId: string, isOverdue: boolean): TaskReaction[] {
  if (!isOverdue || rand() > 0.4) return [];
  const head = departmentHead(departmentId);
  if (head === assigneeId) return [];
  const notes = [
    "เลยกำหนดแล้วนะ รีบอัปเดตด้วย",
    "ทีมรอผลงานนี้อยู่ ช่วยเร่งหน่อย",
    "นี่รอบที่สองแล้วที่ล่าช้า",
  ];
  return [
    {
      id: `${taskId}-rxn-1`,
      stickerId: "angry",
      byUserId: head,
      note: pick(notes),
      createdAt: iso(addDays(today, -Math.floor(rand() * 3))),
    },
  ];
}

export const tasks: Task[] = taskTitles.map((title, i) => {
  const id = `task-${String(i + 1).padStart(3, "0")}`;
  const assignee = pick(users);
  const status = i < 6 ? statuses[i % statuses.length]! : pick(statuses);
  const priority = pick(priorities);
  const start = addDays(today, -Math.floor(rand() * 30));
  const originalDue = addDays(start, Math.floor(rand() * 20) + 3);
  const revisionCount = rand() < 0.25 ? Math.floor(rand() * 3) + 1 : 0;
  const { revisions, finalDate } = makeRevisions(id, revisionCount, originalDue);
  const dueDate = revisionCount > 0 ? finalDate : originalDue;
  const isOverdue = status !== "done" && dueDate.getTime() < today.getTime();

  const head = departmentHead(assignee.departmentId);
  const assignedById = rand() < 0.6 ? head : pick(users.filter((u) => u.id !== assignee.id)).id;

  // Primary assignee + occasional collaborators (multi-assignee).
  const extraCount = rand() < 0.3 ? Math.floor(rand() * 2) + 1 : 0;
  const collaborators = pickN(users.filter((u) => u.id !== assignee.id), extraCount).map((u) => u.id);
  const assigneeIds = [assignee.id, ...collaborators];
  const taskMode: "individual" | "group" = assigneeIds.length > 1 ? "group" : "individual";
  const checklistCount = rand() < 0.55 ? Math.floor(rand() * 3) + 2 : 0;
  const checklist =
    checklistCount > 0
      ? assigneeIds
          .flatMap((uid) => makeChecklist(id, Math.max(1, Math.floor(checklistCount / assigneeIds.length)), status === "done", uid))
      : [];

  return {
    id,
    title,
    description: `${title} ต้องวางแผน ดำเนินการ และตรวจสอบร่วมกับผู้เกี่ยวข้องก่อนปิดงาน ประสานงานกับฝ่าย${pick(departments).name}ตามความจำเป็น`,
    status,
    priority,
    taskMode,
    assigneeIds,
    assignedById,
    departmentIds: [...new Set(assigneeIds.map((uid) => users.find((u) => u.id === uid)!.departmentId))],
    startDate: iso(start),
    dueDate: iso(dueDate),
    originalDueDate: iso(originalDue),
    attachments: makeAttachments(id, Math.floor(rand() * 3), assignee.id),
    comments: makeComments(id, Math.floor(rand() * 4)),
    revisions,
    reactions: makeReactions(id, assignee.id, assignee.departmentId, isOverdue),
    checklist,
    completedAssigneeIds: deriveCompletedAssigneeIds(assigneeIds, checklist),
    showChecklistOnCard: rand() < 0.35,
    createdAt: iso(addDays(start, -2)),
    updatedAt: iso(addDays(today, -Math.floor(rand() * 5))),
  };
});

// ---- Calendar events ----
const meetingTitles = ["วางแผนสปรินต์", "รีวิวงานดีไซน์", "คุยหนึ่งต่อหนึ่ง", "ประชุมรวมทั้งบริษัท", "คุยกับลูกค้า", "ถอดบทเรียน (Retro)", "ทบทวนโรดแมป", "ทบทวนงบประมาณ"];
// ---- Thai public holidays, generated for 2026–2036 ----
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
// FullCalendar's all-day end date is exclusive, so end = the day after.
const nextYmd = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

// Fixed-date national holidays — same Gregorian date every year.
const fixedHolidayDefs: { month: number; day: number; title: string }[] = [
  { month: 1, day: 1, title: "วันขึ้นปีใหม่" },
  { month: 4, day: 6, title: "วันจักรี" },
  { month: 5, day: 1, title: "วันแรงงานแห่งชาติ" },
  { month: 5, day: 4, title: "วันฉัตรมงคล" },
  { month: 6, day: 3, title: "วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี" },
  { month: 7, day: 28, title: "วันเฉลิมพระชนมพรรษา ร.10" },
  { month: 8, day: 12, title: "วันแม่แห่งชาติ (วันเฉลิมพระชนมพรรษาพระบรมราชชนนีพันปีหลวง)" },
  { month: 10, day: 13, title: "วันคล้ายวันสวรรคต ร.9" },
  { month: 10, day: 23, title: "วันปิยมหาราช" },
  { month: 12, day: 5, title: "วันพ่อแห่งชาติ (วันชาติ)" },
  { month: 12, day: 10, title: "วันรัฐธรรมนูญ" },
  { month: 12, day: 31, title: "วันสิ้นปี" },
];

// Buddhist holidays follow the lunar calendar and shift each year, so they are
// only listed for years with officially published dates (extend as announced).
const lunarHolidaysByYear: Record<number, { start: string; end: string; title: string }[]> = {
  2026: [
    { start: "2026-03-03", end: "2026-03-04", title: "วันมาฆบูชา" },
    { start: "2026-05-31", end: "2026-06-01", title: "วันวิสาขบูชา" },
    { start: "2026-07-29", end: "2026-07-30", title: "วันอาสาฬหบูชา" },
    { start: "2026-07-30", end: "2026-07-31", title: "วันเข้าพรรษา" },
  ],
};

const HOLIDAY_YEARS = Array.from({ length: 11 }, (_, i) => 2026 + i); // 2026–2036

const holidayEvents: CalendarEvent[] = HOLIDAY_YEARS.flatMap((year) => {
  const list: CalendarEvent[] = fixedHolidayDefs.map((h, i) => ({
    id: `hol-${year}-f${i}`,
    title: h.title,
    type: "holiday",
    start: ymd(year, h.month, h.day),
    end: nextYmd(year, h.month, h.day),
    allDay: true,
  }));

  // Songkran spans 13–15 April.
  list.push({
    id: `hol-${year}-songkran`,
    title: "วันสงกรานต์",
    type: "holiday",
    start: ymd(year, 4, 13),
    end: ymd(year, 4, 16),
    allDay: true,
  });

  (lunarHolidaysByYear[year] ?? []).forEach((h, i) => {
    list.push({
      id: `hol-${year}-l${i}`,
      title: h.title,
      type: "holiday",
      start: h.start,
      end: h.end,
      allDay: true,
    });
  });

  return list;
});

const leaveTypes: CalendarEvent["leaveType"][] = ["vacation", "sick", "personal", "wfh"];
const leaveTypeShortLabel: Record<NonNullable<CalendarEvent["leaveType"]>, string> = {
  vacation: "ลาพักร้อน",
  sick: "ลาป่วย",
  personal: "ลากิจ",
  wfh: "ทำงานที่บ้าน",
};

const leaveEvents: CalendarEvent[] = Array.from({ length: 20 }).map((_, i) => {
  const user = pick(users);
  const start = addDays(today, Math.floor(rand() * 40) - 10);
  const span = pick([0, 0, 1, 2]);
  const lt = pick(leaveTypes)!;
  return {
    id: `leave-${i + 1}`,
    title: `${user.name.split(" ")[0]} - ${leaveTypeShortLabel[lt]}`,
    type: "leave" as const,
    start: iso(start).slice(0, 10),
    end: iso(addDays(start, span)).slice(0, 10),
    allDay: true,
    userId: user.id,
    leaveType: lt,
  };
});

const meetingEvents: CalendarEvent[] = Array.from({ length: 18 }).map((_, i) => {
  const dept = pick(departments);
  const start = addDays(today, Math.floor(rand() * 30) - 7);
  start.setHours(9 + Math.floor(rand() * 7), pick([0, 30]), 0, 0);
  const end = new Date(start.getTime() + (pick([30, 45, 60, 90]) as number) * 60000);
  return {
    id: `meet-${i + 1}`,
    title: pick(meetingTitles),
    type: "meeting" as const,
    start: iso(start),
    end: iso(end),
    allDay: false,
    departmentId: dept.id,
    location: pick(["ห้องประชุม A", "ห้องประชุม B", "Zoom", "Google Meet", "สำนักงานใหญ่ ชั้น 5"]),
  };
});

export const calendarEvents: CalendarEvent[] = [
  ...holidayEvents,
  ...leaveEvents,
  ...meetingEvents,
];

// ---- Activity feed ----
const actions = [
  "ย้ายสถานะ", "ทำเสร็จ", "แสดงความเห็นใน", "สร้าง", "มอบหมาย", "อัปโหลดไฟล์ไปยัง", "แก้ไขกำหนดส่งของ",
];
export const activity: ActivityItem[] = Array.from({ length: 24 }).map((_, i) => {
  const task = pick(tasks);
  const user = pick(users);
  return {
    id: `act-${i + 1}`,
    userId: user.id,
    action: pick(actions),
    target: task.title,
    taskId: task.id,
    createdAt: iso(addDays(today, -Math.floor(rand() * 10))).replace(
      /T.*/,
      `T${String(8 + Math.floor(rand() * 10)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00.000Z`
    ),
  };
}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

// ---- Helpers ----
export function getUser(id: string) {
  return users.find((u) => u.id === id);
}
export function getDepartment(id: string) {
  return departments.find((d) => d.id === id);
}
export function getTask(id: string) {
  return tasks.find((t) => t.id === id);
}
export function isDepartmentHead(userId: string) {
  return departments.some((d) => d.headId === userId);
}
export function isOwner(userId: string) {
  return getUser(userId)?.isOwner === true;
}
/** Anyone with manager-level UI access — a department head or the company-wide owner. */
export function canManage(userId: string) {
  return isDepartmentHead(userId) || isOwner(userId);
}
export function headOfDepartment(departmentId: string) {
  return departmentHead(departmentId);
}
/** Unique departments covered by a set of users — a task's departments follow its assignees. */
export function departmentIdsOf(userIds: string[]): string[] {
  const set = new Set<string>();
  for (const id of userIds) {
    const dep = users.find((u) => u.id === id)?.departmentId;
    if (dep) set.add(dep);
  }
  return [...set];
}

export const today_ = today;
