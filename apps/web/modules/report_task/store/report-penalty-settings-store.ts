import { create } from "zustand";

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
  setEnabled: (v: boolean) => void;
}

// Server-synced via ServerStoreSync (apiKey "report-penalty-settings") in
// store-hydrator.tsx — shared org-wide config, not per-browser.
export const useReportPenaltySettingsStore = create<ReportPenaltySettingsStore>()((set) => ({
  enabled: false,
  setEnabled: (v) => set({ enabled: v }),
}));
