import { create } from "zustand";
import { todayIso } from "@/modules/report_task/lib/now";
import type { ScorePeriodConfig } from "@/lib/score-period";
import {
  DEFAULT_EARLY_SUBMIT_DAYS,
  normalizeEarlySubmitDays,
  type EarlySubmitDays,
} from "@/modules/report_task/lib/submission-rounds";

interface ReportPenaltySettingsStore {
  /**
   * เปิด/ปิด sweep ที่หักคะแนน HR อัตโนมัติเมื่อพลาด/ส่งช้ารอบส่งรายงาน
   * (category `report_missed`/`report_late`, ดู lib/report-penalty-sweep.ts) —
   * แยกจาก `performance_settings.enabled` (สวิตช์รวมทั้งบริษัทที่ /admin/performance/settings)
   * เผื่อบริษัทอยากเปิดคะแนนผลงานเรื่องอื่นอยู่แล้วแต่ยังไม่พร้อมเปิดหักเรื่อง
   * รายงาน (เช่นเพิ่งย้ายมาใช้ระบบรอบส่งรายงาน อยากดูตัวเลข "จะพลาด/สาย" ในหน้า
   * สรุปนิ่ง ๆ ก่อนค่อยเปิดหักจริง — ดู spec-report-submission-rounds.md ข้อ 7)
   *
   * ปิดไว้เป็นค่าเริ่มต้น (`false`) โดยตั้งใจ — บริษัทที่อัปเกรดมาไม่ควรถูกหัก
   * คะแนนย้อนหลังทันทีที่ deploy ฟีเจอร์นี้ ต้องมากดเปิดเองที่นี่ก่อน
   */
  enabled: boolean;
  /**
   * "YYYY-MM-DD" ของครั้งล่าสุดที่กดเปิดสวิตช์นี้ — lib/report-penalty-sweep.ts
   * ใช้เป็นเพดานล่าง **ไม่หักคะแนนของวันก่อนหน้านี้เด็ดขาด** ไม่ว่า lookback
   * ของ sweep จะกว้างแค่ไหน (ค่าเริ่มต้น 45 วัน กันไว้เผื่อเซิร์ฟเวอร์ล่มไปนาน)
   *
   * เดิมไม่มีฟิลด์นี้ — ครั้งแรกที่เปิดสวิตช์แล้ว sweep ไล่ย้อนหลังเต็ม 45 วัน
   * ไปหักของทุกวันที่เคยพลาดในอดีต (ก่อนฟีเจอร์นี้จะมีอยู่ด้วยซ้ำ) พร้อมกัน
   * รวดเดียว ทั้งที่เจตนาจริงคือ "เปิดวันไหนเริ่มนับจากวันนั้น" — เป็นบั๊กที่
   * เจอจริงจากการใช้งาน (พนักงานหลายคนโดนหักคะแนนย้อนหลังพร้อมกันตอนเปิด
   * สวิตช์ครั้งแรก) จึงต้องมีฟิลด์นี้กันไว้ตรง ๆ แทนที่จะพึ่ง lookback อย่างเดียว
   */
  enabledSince: string | null;
  /**
   * รอบรายสัปดาห์/รายเดือน "เผื่อเวลา" ส่งย้อนหลังได้กี่วัน หลังพ้นวันครบกำหนด
   * ไปแล้ว ก่อนจะกลายเป็น "พลาด" (-2) ถาวร — ระหว่างช่วงนี้ถ้าส่งทันยังนับเป็น
   * "สาย" (-1) เท่านั้น เหมือน pmGraceDays/workOrderGraceDays ที่มีอยู่แล้วใน
   * core.performance_settings (แต่คีย์นี้แยกเก็บในโมดูลรายงานเอง ไม่แตะ schema
   * ของ performance_settings) — ไม่มีผลกับรอบรายวัน (รายวันมี "เผื่อเวลา" ของ
   * ตัวเองอยู่แล้วคือ hard cutoff ของห้อง ดู report-penalty-sweep.ts)
   */
  weeklyMonthlyGraceDays: number;
  /**
   * รอบรายสัปดาห์/รายเดือน "ส่งล่วงหน้า" ได้กี่วันก่อนวันครบกำหนด (นับเป็นตรงเวลา) — ดู
   * EarlySubmitDays ใน lib/submission-rounds.ts · เก็บแยกคีย์ "report-early-submit-days"
   */
  earlySubmitDays: EarlySubmitDays;
  /**
   * วันตัดรอบเกรดของบริษัท (อ่านอย่างเดียว — /api/report-task/score-period ใน store-hydrator.tsx)
   * ช่วงส่งย้อนหลังข้างบนไม่เลยวันตัดรอบ (graceEndWithinPeriod) ให้แดชบอร์ดตัดสินตรงกับตัวหักคะแนน · null = ยังไม่โหลด
   */
  scorePeriod: ScorePeriodConfig | null;
  setEnabled: (v: boolean) => void;
  setWeeklyMonthlyGraceDays: (n: number) => void;
  setEarlySubmitDays: (patch: Partial<EarlySubmitDays>) => void;
}

// Server-synced via ServerStoreSync (apiKey "report-penalty-settings" +
// "report-penalty-enabled-since") ใน store-hydrator.tsx — shared org-wide
// config, not per-browser.
export const useReportPenaltySettingsStore = create<ReportPenaltySettingsStore>()((set) => ({
  enabled: false,
  enabledSince: null,
  weeklyMonthlyGraceDays: 3,
  earlySubmitDays: DEFAULT_EARLY_SUBMIT_DAYS,
  scorePeriod: null,
  // ทุกครั้งที่เปิด (แม้จะเคยเปิดมาก่อนแล้วปิดแล้วเปิดใหม่) ตั้ง enabledSince
  // เป็นวันนี้เสมอ — กันไม่ให้ช่วงที่เคยปิดไว้ถูกแบ็คฟิลย้อนหลังตอนเปิดใหม่ด้วย
  setEnabled: (v) => set(v ? { enabled: true, enabledSince: todayIso() } : { enabled: false }),
  setWeeklyMonthlyGraceDays: (n) => set({ weeklyMonthlyGraceDays: Math.max(0, Math.round(n) || 0) }),
  setEarlySubmitDays: (patch) => set((s) => ({ earlySubmitDays: normalizeEarlySubmitDays({ ...s.earlySubmitDays, ...patch }) })),
}));
