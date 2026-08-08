/** ตัวเลือกชนิดปัญหาของการคืนของ (client-safe) — ตรงกับ ReturnProblemType เดิม */
export const RETURN_PROBLEM_OPTIONS = [
  { value: "defective", label: "ชำรุด / ใช้งานไม่ได้" },
  { value: "wrong", label: "ผิดรุ่น / ผิดสเปก" },
  { value: "damaged", label: "แตกหักระหว่างส่ง" },
  { value: "missing", label: "ของขาด / ไม่ครบ" },
  { value: "other", label: "อื่น ๆ" },
] as const;
