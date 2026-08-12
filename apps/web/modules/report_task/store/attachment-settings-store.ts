import { create } from "zustand";

export interface AttachmentSettings {
  /** MB ต่อไฟล์ แยกตามชนิด — ตรงกับ ALLOWED_TYPES เดิมใน uploads/route.ts */
  maxImageMB: number;
  maxFileMB: number;
  maxVideoMB: number;
  /** จำนวนไฟล์แนบสูงสุดต่องานหนึ่งงาน / ความคิดเห็นหนึ่งรายการ */
  maxFilesPerTask: number;
  maxFilesPerComment: number;
}

/** ค่าเริ่มต้น — เท่ากับ limit ตายตัวเดิมก่อนทำให้ปรับได้ (ไม่มีแถว = ใช้ค่านี้) */
export const DEFAULT_ATTACHMENT_SETTINGS: AttachmentSettings = {
  maxImageMB: 8,
  maxFileMB: 8,
  maxVideoMB: 25,
  maxFilesPerTask: 20,
  maxFilesPerComment: 5,
};

interface AttachmentSettingsStore {
  settings: AttachmentSettings;
  setSettings: (patch: Partial<AttachmentSettings>) => void;
}

/**
 * ขนาด/จำนวนไฟล์แนบสูงสุดของบริษัทนี้ — ปรับได้ที่หน้าตั้งค่า (งาน → ไฟล์แนบ)
 *
 * ตอนนี้เป็นค่าเดียวต่อบริษัท ยังไม่ผูกกับแพ็กเกจสมัครสมาชิก (planCode) —
 * เจ้าของบริษัทปรับเองตามแพ็กเกจที่จ่ายจริง วันหน้าจะผูกอัตโนมัติกับ planCode
 * ก็ทำได้โดยเปลี่ยนแค่ค่าเริ่มต้นตอนสร้างบริษัทใหม่ ไม่ต้องแก้กลไกนี้เลย
 *
 * Server-synced via ServerStoreSync (apiKey "attachment-settings") ใน
 * store-hydrator.tsx — ฝั่งเซิร์ฟเวอร์ (uploads/route.ts) อ่านค่าเดียวกันนี้
 * ตรงจาก DB ไปบังคับจริง ไม่ใช่แค่ตรวจฝั่ง client
 */
export const useAttachmentSettingsStore = create<AttachmentSettingsStore>()((set) => ({
  settings: DEFAULT_ATTACHMENT_SETTINGS,
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
}));
