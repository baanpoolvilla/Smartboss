/**
 * ผลอ่านใบเสร็จ/สลิปด้วย AI (ผู้ใช้ 3/11/2569 "อ่านใบเสร็จได้ด้วย โอนให้ใคร เวลา เลขใบเสร็จ")
 * ระบบเติมลงฟอร์มให้ คนต้องตรวจแล้วกดบันทึกเอง — ไม่บันทึกอัตโนมัติ AI อ่านเลขผิดได้
 */
export type PaymentMethod = "cash" | "transfer" | "card" | "other";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอนเงิน" },
  { value: "card", label: "บัตร" },
  { value: "other", label: "อื่น ๆ" },
];

export function paymentMethodLabel(v: string | null | undefined): string | null {
  return PAYMENT_METHODS.find((m) => m.value === v)?.label ?? null;
}

export interface ReceiptData {
  amount: number | null;
  /** YYYY-MM-DDTHH:mm เวลาไทย (ค่าของ input datetime-local) */
  paidAt: string | null;
  receiptNo: string | null;
  payee: string | null;
  payer: string | null;
  paymentMethod: PaymentMethod | null;
  summary: string | null;
}

const text = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "null" ? t.slice(0, max) : null;
};

/** แปลงคำตอบของ AI เป็นค่าที่เชื่อได้ ช่องไหนอ่านไม่ได้ = null — ไม่เดา */
export function normalizeReceipt(raw: unknown): ReceiptData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const n = typeof r.amount === "number" ? r.amount : Number(String(r.amount ?? "").replace(/[\s,฿]/g, "") || NaN);
  const amount = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;

  let paidAt: string | null = null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(r.paid_at ?? "").trim());
  if (m) {
    // ใบเสร็จไทยมักเป็น พ.ศ.
    const y = Number(m[1]) > 2400 ? Number(m[1]) - 543 : Number(m[1]);
    const candidate = `${y}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}`;
    if (!Number.isNaN(Date.parse(`${candidate}:00+07:00`))) paidAt = candidate;
  }

  const method = String(r.payment_method ?? "").trim().toLowerCase();
  return {
    amount,
    paidAt,
    receiptNo: text(r.receipt_no, 100),
    payee: text(r.payee),
    payer: text(r.payer),
    paymentMethod: PAYMENT_METHODS.some((p) => p.value === method) ? (method as PaymentMethod) : null,
    summary: text(r.summary, 300),
  };
}

/** อ่านอะไรได้บ้าง — ไม่ได้เลยให้บอกคนว่าต้องกรอกเอง */
export function receiptHasData(d: ReceiptData): boolean {
  return d.amount !== null || !!d.paidAt || !!d.receiptNo || !!d.payee;
}
