import { create } from "zustand";
import { todayIso } from "@/modules/report_task/lib/now";

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
  setEnabled: (v: boolean) => void;
}

// Server-synced via ServerStoreSync (apiKey "report-penalty-settings" +
// "report-penalty-enabled-since") ใน store-hydrator.tsx — shared org-wide
// config, not per-browser.
export const useReportPenaltySettingsStore = create<ReportPenaltySettingsStore>()((set) => ({
  enabled: false,
  enabledSince: null,
  // ทุกครั้งที่เปิด (แม้จะเคยเปิดมาก่อนแล้วปิดแล้วเปิดใหม่) ตั้ง enabledSince
  // เป็นวันนี้เสมอ — กันไม่ให้ช่วงที่เคยปิดไว้ถูกแบ็คฟิลย้อนหลังตอนเปิดใหม่ด้วย
  setEnabled: (v) => set(v ? { enabled: true, enabledSince: todayIso() } : { enabled: false }),
}));
