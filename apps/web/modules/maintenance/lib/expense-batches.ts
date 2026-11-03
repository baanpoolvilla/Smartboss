/**
 * ใบงานหลายบ้านบันทึกไว้บ้านละแถว ยอดเต็มทุกแถว (createExpensesForProperties) — รายงานรายบ้านใช้แถวตรง ๆ
 * แต่เงินที่จ่ายจริงคือครั้งเดียว ใช้ตัวนี้รวมแถวของการบันทึกครั้งเดียวกันเวลาแสดงยอดจ่ายจริง/ใบเสร็จ
 * ชุดเดียวกัน = ใบงาน คนบันทึก ยอด คำอธิบายเดียวกัน บันทึกห่างกันไม่เกิน 10 วินาที (เกณฑ์เดียวกับ updateExpenseBatch)
 */
export interface BatchableExpense {
  workOrderId: string | null;
  createdBy: string | null;
  amount: unknown;
  description: string | null;
  createdAt: Date;
}

export interface ExpenseBatch<T> {
  first: T;
  rows: T[];
  /** ยอดจ่ายจริงของชุดนี้ */
  amount: number;
  houses: number;
}

const WINDOW_MS = 10_000;

export function groupExpenseBatches<T extends BatchableExpense>(rows: T[]): ExpenseBatch<T>[] {
  const batches: ExpenseBatch<T>[] = [];
  const last = new Map<string, ExpenseBatch<T>>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const amount = Number(r.amount);
    const key = r.workOrderId ? `${r.workOrderId}|${r.createdBy}|${amount}|${r.description}` : null;
    const cur = key ? last.get(key) : undefined;
    if (cur && r.createdAt.getTime() - cur.first.createdAt.getTime() <= WINDOW_MS) {
      cur.rows.push(r);
      cur.houses += 1;
      continue;
    }
    const batch: ExpenseBatch<T> = { first: r, rows: [r], amount, houses: 1 };
    batches.push(batch);
    if (key) last.set(key, batch);
  }
  return batches;
}

/** ยอดจ่ายจริงรวม (ไม่นับซ้ำตามจำนวนบ้าน) */
export function realExpenseTotal(rows: BatchableExpense[]): number {
  return groupExpenseBatches(rows).reduce((n, b) => n + b.amount, 0);
}
