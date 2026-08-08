import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WhatsNewItem {
  id: string;
  /** Which page this feature lives on — the "มีอะไรใหม่" popover only ever shows items for whatever page the viewer is currently on, matching the tour being per-page too. */
  page: string;
  title: string;
  description: string;
  /** Matches a tourStepsByPage[page][].target in tour-store.ts — lets "ดูตัวอย่าง" jump the spotlight tour straight to this feature instead of only reading about it. */
  tourTarget: string;
}

/**
 * Content lives here, not in a CMS — a short, hand-written list of recent
 * features worth surfacing to someone who hasn't noticed them yet, grouped by
 * the page each one lives on. Newest first within a page; add a new entry
 * whenever something non-obvious ships, and everyone who hasn't dismissed it
 * gets the badge again.
 */
export const whatsNewItems: WhatsNewItem[] = [
  {
    id: "mention-drag-drop",
    page: "/report-feed",
    title: "ลากห้องมาแท็กในโพสต์ได้เลย",
    description: "ลากหัวข้อ/ห้องจากแถบด้านซ้ายมาวางในกล่องข้อความของโพสต์ กลายเป็นแท็กห้องทันที ไม่ต้องพิมพ์ @ ก่อน",
    tourTarget: "topic-row",
  },
  {
    id: "mention-at",
    page: "/report-feed",
    title: "แท็ก @คน @ห้อง @แผนก ในโพสต์",
    description: "พิมพ์ @ ในข้อความโพสต์เพื่อแท็กคน ห้อง Report หรือแผนก — คนที่ถูกแท็กจะได้รับการแจ้งเตือนทันที",
    tourTarget: "composer-trigger",
  },
  {
    id: "topic-favorites",
    page: "/report-feed",
    title: "ติดดาวห้องที่ใช้บ่อย",
    description: "วางเมาส์เหนือหัวข้อในแถบด้านซ้ายแล้วกดไอคอนดาว หัวข้อนั้นจะย้ายไปอยู่ในหมวด \"รายการโปรด\" ด้านบนสุด",
    tourTarget: "topic-star",
  },
  {
    id: "room-members-dialog",
    page: "/report-feed",
    title: "จัดการสมาชิกห้อง Report",
    description: "กดจำนวนคนที่หัวข้อห้องเพื่อดูรายชื่อสมาชิก ค้นหา กรองแผนก และเพิ่ม/ลบคนได้ (ตามสิทธิ์ของคุณ)",
    tourTarget: "member-count",
  },
  {
    id: "dashboard-customize",
    page: "/",
    title: "ปรับแต่งแดชบอร์ดได้เอง",
    description: "กด \"ปรับแต่ง\" เพื่อซ่อน/แสดงวิดเจ็ต ปรับความกว้าง หรือจัดเรียงใหม่ตามที่ใช้บ่อย",
    tourTarget: "dashboard-customize",
  },
  {
    id: "dashboard-given-tab",
    page: "/",
    title: "ดูงานที่คุณแจกให้คนอื่น",
    description: "แท็บในการ์ดงานค้าง โชว์เฉพาะงานที่คุณเป็นคนสร้าง/มอบหมายให้คนอื่น แยกจากงานของตัวเอง",
    tourTarget: "dashboard-given-tab",
  },
  {
    id: "task-view-grid",
    page: "/tasks",
    title: "สลับดูงานเป็นตารางได้",
    description: "ข้อมูลชุดเดียวกับบอร์ด แต่แสดงเป็นตาราง กดหัวคอลัมน์เพื่อเรียงลำดับได้",
    tourTarget: "task-view-grid",
  },
  {
    id: "task-select-mode",
    page: "/tasks",
    title: "เลือกหลายงานพร้อมกันเพื่อทำทีเดียว",
    description: "กด \"เลือกหลายรายการ\" แล้วติ๊กเลือกหลายการ์ด จะมีแถบเปลี่ยนสถานะ/ความสำคัญหลายงานพร้อมกันโผล่ขึ้นมา",
    tourTarget: "task-select-mode-toggle",
  },
  {
    id: "calendar-priority-filter",
    page: "/calendar",
    title: "กรองงานตามความสำคัญ",
    description: "คลิกป้ายความสำคัญ (สูง/กลาง/ต่ำ) เหนือปฏิทิน เพื่อซ่อนหรือแสดงเฉพาะงานระดับนั้น",
    tourTarget: "calendar-priority-filter",
  },
  {
    id: "calendar-meetings-toggle",
    page: "/calendar",
    title: "ซ่อน/แสดงประชุมบนปฏิทิน",
    description: "คลิกป้าย \"ประชุม\" เพื่อซ่อนนัดประชุมออกจากปฏิทินชั่วคราว ดูเฉพาะงานอย่างเดียวได้",
    tourTarget: "calendar-meetings-toggle",
  },
  {
    id: "calendar-tab-schedule",
    page: "/calendar",
    title: "แยกดูวันหยุด/วันลาต่างหาก",
    description: "แท็บ \"วันหยุด · ลา\" สลับไปดูปฏิทินวันหยุดประจำและวันลาแยกจากปฏิทินงาน/ประชุม",
    tourTarget: "calendar-tab-schedule",
  },
  {
    id: "calendar-view-switch",
    page: "/calendar",
    title: "สลับมุมมองปฏิทิน เดือน/สัปดาห์/วัน/กำหนดการ",
    description: "กดปุ่มมุมมองเหล่านี้ (หรือกด 1-4 บนคีย์บอร์ด) เพื่อสลับมุมมองปฏิทินได้ทันที",
    tourTarget: "calendar-view-week",
  },
  {
    id: "calendar-scope-all",
    page: "/calendar",
    title: "ดูงานทั้งแผนก ไม่ใช่แค่ของตัวเอง",
    description: "สลับ \"งานของฉัน / ทั้งหมด\" เพื่อดูงานทุกคนในแผนกบนปฏิทินเดียวกัน",
    tourTarget: "calendar-scope-all",
  },
  {
    id: "calendar-drag-select",
    page: "/calendar",
    title: "ลากคลุมหลายวันเพื่อดูสรุปช่วงนั้น",
    description: "ลากคลุมจากวันหนึ่งไปอีกวันบนปฏิทิน จะเด้งสรุปงาน ประชุม และวันลาทั้งหมดในช่วงนั้นขึ้นมาให้ดูรวดเดียว",
    tourTarget: "calendar-today-cell",
  },
  {
    id: "activity-search",
    page: "/activity-log",
    title: "ค้นหากิจกรรมแบบพิมพ์สด",
    description: "พิมพ์ชื่องาน การกระทำ หรือรายละเอียดในช่องค้นหา รายการด้านล่างจะกรองแบบเรียลไทม์ทันที",
    tourTarget: "activity-search",
  },
  {
    id: "settings-email-toggle",
    page: "/settings",
    title: "เปิด/ปิดแจ้งเตือนอีเมลทั้งหมดด้วยสวิตช์เดียว",
    description: "สวิตช์นี้คุมทุกหมวดแจ้งเตือนด้านล่างพร้อมกัน อยู่ในหน้าตั้งค่า > โปรไฟล์ของฉัน",
    tourTarget: "settings-email-toggle",
  },
];

interface WhatsNewStore {
  /** Announcement ids each viewer has already seen — per viewingAs identity, since this demo simulates several roles in one browser. */
  seenIds: Record<string, string[]>;
  markSeen: (userId: string, ids: string[]) => void;
}

export const useWhatsNewStore = create<WhatsNewStore>()(
  persist(
    (set) => ({
      seenIds: {},
      markSeen: (userId, ids) =>
        set((s) => ({
          seenIds: { ...s.seenIds, [userId]: [...new Set([...(s.seenIds[userId] ?? []), ...ids])] },
        })),
    }),
    { name: "eb-whats-new", skipHydration: true }
  )
);
