import { create } from "zustand";

export type TourDemo =
  /** Genuinely clicks the step's own target, waits a beat, then clicks it again (or `revertTarget`, if the toggle is really two separate buttons like a tab pair) to put it back the way it found it. */
  | { type: "toggle-click"; revertTarget?: string }
  /** Genuinely clicks the step's own target (opening something, e.g. a members dialog), waits so it's visible, then clicks `closeTarget` to close it back up. */
  | { type: "click-and-close"; closeTarget: string }
  /** Genuinely clicks the step's own target (e.g. expanding the composer), waits for `intoTarget` to mount, types `text` into it for real (so e.g. the real @mention dropdown appears), waits, then clicks `revertTarget` to put the page back the way it found it. */
  | { type: "click-and-type"; intoTarget: string; text: string; revertTarget?: string }
  | {
      type: "drag";
      toTarget: string;
      /** Real drop target only exists after this is actually clicked first (e.g. the composer has to be expanded before its text box exists) — the demo genuinely clicks it, waits for `toTarget` to mount, then drags. */
      expandFirst?: string;
      /** Clicked after the drop completes, to leave the page back the way this step found it (e.g. re-collapsing the composer) so later steps' targets still exist. */
      collapseAfter?: string;
    }
  /** Drags from the step's own target (today's calendar cell) roughly `toDateOffsetDays` days out, firing real mouse events so the calendar's own native drag-select (FullCalendar) tracks it — a plain pointer drag across day cells, not a native HTML5 drag like the `drag` type above. Waits so whatever it opens (a range summary) is visible, then clicks `closeTarget`. Read-only — a selected range only ever opens a summary popup, never edits anything. */
  | { type: "drag-select"; toDateOffsetDays: number; closeTarget: string };

export interface TourStep {
  /** Which page this step's target lives on — e.g. "/tasks", "/report-feed". Starting a tour navigates here first if the viewer isn't already on it. */
  page: string;
  /** Matches a `data-tour="..."` attribute on the real element being pointed at. */
  target: string;
  title: string;
  description: string;
  /** An animated cursor plays this out automatically once the spotlight lands — a "watch it happen" demo, not a scripted click that mutates real data. `drag` animates a ghost chip from this step's target to `toTarget`. */
  demo: TourDemo;
}

const dashboardTourSteps: TourStep[] = [
  {
    page: "/",
    target: "dashboard-customize",
    title: "ปรับแต่งแดชบอร์ดได้เอง",
    description: "กด \"ปรับแต่ง\" เพื่อซ่อน/แสดงวิดเจ็ต ปรับความกว้าง หรือจัดเรียงใหม่ตามที่ใช้บ่อย กด \"เสร็จสิ้น\" เมื่อจัดเสร็จ",
    demo: { type: "click-and-close", closeTarget: "dashboard-customize-done" },
  },
  {
    page: "/",
    target: "dashboard-given-tab",
    title: "ดูงานที่คุณแจกให้คนอื่น",
    description: "แท็บนี้ในการ์ดงานค้าง โชว์เฉพาะงานที่คุณเป็นคนสร้าง/มอบหมายให้คนอื่น แยกจากงานของตัวเอง",
    demo: { type: "toggle-click", revertTarget: "dashboard-mine-tab" },
  },
];

const tasksTourSteps: TourStep[] = [
  {
    page: "/tasks",
    target: "task-view-grid",
    title: "สลับดูงานเป็นตารางได้",
    description: "ข้อมูลชุดเดียวกับบอร์ด แต่แสดงเป็นตาราง กดหัวคอลัมน์เพื่อเรียงลำดับได้ เหมาะเวลาอยากไล่ดูทีละแถว",
    demo: { type: "toggle-click", revertTarget: "task-view-board" },
  },
  {
    page: "/tasks",
    target: "task-select-mode-toggle",
    title: "เลือกหลายงานพร้อมกันเพื่อทำทีเดียว",
    description: "กด \"เลือกหลายรายการ\" แล้วติ๊กเลือกหลายการ์ด จะมีแถบเปลี่ยนสถานะ/ความสำคัญหลายงานพร้อมกันโผล่ขึ้นมา",
    demo: { type: "toggle-click" },
  },
];

const calendarTourSteps: TourStep[] = [
  {
    page: "/calendar",
    target: "calendar-priority-filter",
    title: "กรองงานตามความสำคัญ",
    description: "คลิกป้ายความสำคัญ (สูง/กลาง/ต่ำ) เหนือปฏิทิน เพื่อซ่อนหรือแสดงเฉพาะงานระดับนั้นบนปฏิทิน คลิกซ้ำเพื่อแสดงกลับ",
    demo: { type: "toggle-click" },
  },
  {
    page: "/calendar",
    target: "calendar-meetings-toggle",
    title: "ซ่อน/แสดงประชุมบนปฏิทิน",
    description: "คลิกป้าย \"ประชุม\" เพื่อซ่อนนัดประชุมทั้งหมดออกจากปฏิทินชั่วคราว ดูเฉพาะงานอย่างเดียวได้ คลิกซ้ำเพื่อแสดงกลับ",
    demo: { type: "toggle-click" },
  },
  {
    page: "/calendar",
    target: "calendar-tab-schedule",
    title: "แยกดูวันหยุด/วันลาต่างหาก",
    description: "แท็บ \"วันหยุด · ลา\" สลับไปดูปฏิทินวันหยุดประจำและวันลาแยกจากปฏิทินงาน/ประชุม",
    demo: { type: "toggle-click", revertTarget: "calendar-tab-work" },
  },
  {
    page: "/calendar",
    target: "calendar-view-week",
    title: "สลับมุมมองปฏิทิน เดือน/สัปดาห์/วัน/กำหนดการ",
    description: "กดปุ่มมุมเหล่านี้ (หรือกด 1-4 บนคีย์บอร์ด) เพื่อสลับมุมมองปฏิทินได้ทันที ไม่ต้องเปลี่ยนหน้า",
    demo: { type: "toggle-click", revertTarget: "calendar-view-month" },
  },
  {
    page: "/calendar",
    target: "calendar-scope-all",
    title: "ดูงานทั้งแผนก ไม่ใช่แค่ของตัวเอง",
    description: "สลับ \"งานของฉัน / ทั้งหมด\" เพื่อดูงานทุกคนในแผนก (หรือทั้งบริษัทถ้าเป็นเจ้าของ) บนปฏิทินเดียวกัน",
    demo: { type: "toggle-click", revertTarget: "calendar-scope-mine" },
  },
  {
    page: "/calendar",
    target: "calendar-today-cell",
    title: "ลากคลุมหลายวันเพื่อดูสรุปช่วงนั้น",
    description: "ลากคลุมจากวันหนึ่งไปอีกวันบนปฏิทิน จะเด้งสรุปงาน ประชุม และวันลาทั้งหมดในช่วงนั้นขึ้นมาให้ดูรวดเดียว",
    demo: { type: "drag-select", toDateOffsetDays: 4, closeTarget: "calendar-range-summary-close" },
  },
];

const activityLogTourSteps: TourStep[] = [
  {
    page: "/activity-log",
    target: "activity-search",
    title: "ค้นหากิจกรรมแบบพิมพ์สด",
    description: "พิมพ์ชื่องาน การกระทำ หรือรายละเอียดในช่องนี้ รายการด้านล่างจะกรองแบบเรียลไทม์ทันทีที่พิมพ์",
    demo: { type: "click-and-type", intoTarget: "activity-search", text: "แจ้ง", revertTarget: "activity-clear-filters" },
  },
];

const settingsTourSteps: TourStep[] = [
  {
    page: "/settings",
    target: "settings-email-toggle",
    title: "เปิด/ปิดแจ้งเตือนอีเมลทั้งหมดด้วยสวิตช์เดียว",
    description: "สวิตช์นี้คุมทุกหมวดแจ้งเตือนด้านล่างพร้อมกัน ปิดสวิตช์นี้ครั้งเดียวคือไม่ได้รับอีเมลแจ้งเตือนใดๆ เลย",
    demo: { type: "toggle-click" },
  },
];

const reportTourSteps: TourStep[] = [
  {
    page: "/report-feed",
    target: "topic-row",
    title: "ลากห้องมาแท็กในโพสต์ได้เลย",
    description: "กด \"เริ่มการสนทนาใหม่\" ก่อน แล้วลากหัวข้อ/ห้องแถวไหนก็ได้จากตรงนี้ไปวางในกล่องข้อความของโพสต์ กลายเป็นแท็กห้องทันที ไม่ต้องพิมพ์ @ ก่อน",
    demo: { type: "drag", toTarget: "composer-textbox", expandFirst: "composer-trigger", collapseAfter: "composer-cancel" },
  },
  {
    page: "/report-feed",
    target: "topic-star",
    title: "ติดดาวห้องที่ใช้บ่อย",
    description: "วางเมาส์เหนือหัวข้อแล้วกดไอคอนดาวตรงนี้ หัวข้อนั้นจะย้ายไปอยู่ในหมวด \"รายการโปรด\" ด้านบนสุด กดซ้ำเพื่อเลิกติดดาว",
    demo: { type: "toggle-click" },
  },
  {
    page: "/report-feed",
    target: "member-count",
    title: "จัดการสมาชิกห้อง Report",
    description: "กดตรงนี้เพื่อดูรายชื่อสมาชิก ค้นหา กรองแผนก และเพิ่ม/ลบคนได้ (ตามสิทธิ์ของคุณ — พนักงานทั่วไปดูได้อย่างเดียว)",
    demo: { type: "click-and-close", closeTarget: "member-dialog-close" },
  },
  {
    page: "/report-feed",
    target: "composer-trigger",
    title: "แท็ก @คน @ห้อง @แผนก ในโพสต์",
    description: "กดตรงนี้เพื่อเริ่มเขียนโพสต์ แล้วพิมพ์ @ ในข้อความเพื่อแท็กคน ห้อง หรือแผนก — คนที่ถูกแท็กจะได้รับการแจ้งเตือนทันที",
    demo: { type: "click-and-type", intoTarget: "composer-textbox", text: "@", revertTarget: "composer-cancel" },
  },
];

/** Every page's tour, keyed by its route — the "มีอะไรใหม่" popover and the spotlight overlay both only ever look at whichever page the viewer is currently on. */
export const tourStepsByPage: Record<string, TourStep[]> = {
  "/": dashboardTourSteps,
  "/tasks": tasksTourSteps,
  "/calendar": calendarTourSteps,
  "/report-feed": reportTourSteps,
  "/activity-log": activityLogTourSteps,
  "/settings": settingsTourSteps,
};

interface TourStore {
  active: boolean;
  page: string;
  stepIndex: number;
  /** Starts a page's tour at a given step (defaults to the first) — lets a single "มีอะไรใหม่" item jump straight to its own step instead of always replaying from the top. */
  start: (page: string, stepIndex?: number) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

export const useTourStore = create<TourStore>((set, get) => ({
  active: false,
  page: "/report-feed",
  stepIndex: 0,
  start: (page, stepIndex = 0) => set({ active: true, page, stepIndex }),
  next: () => {
    const { stepIndex, page } = get();
    const steps = tourStepsByPage[page] ?? [];
    if (stepIndex >= steps.length - 1) {
      set({ active: false });
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  stop: () => set({ active: false }),
}));
