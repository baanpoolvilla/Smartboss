import "server-only";

/**
 * คุมเงิน AI ไม่ให้เกินเพดาน (13/11/2569 ผู้ใช้: "เกินได้นิดหน่อย ห้ามบานปลาย")
 *
 * 1) ต่อคิวต่อบริษัท — การเรียก AI ของบริษัทเดียวกันทำทีละงาน (สรุป/ถาม/สรุปรวม/อ่านรูป) จะได้ไม่ผ่านด่านเพดานพร้อมกันหลายงาน
 *    เว็บมีโปรเซสเดียว (cron ก็ยิงเข้าเว็บ) คิวในหน่วยความจำจึงพอ
 * 2) ค่าสูงสุดที่เป็นไปได้ของการเรียกหนึ่งครั้ง คิดจากขนาดข้อความที่จะส่งจริง + จำนวน token ตอบสูงสุด
 *    → เงินที่เหลือไม่พอ "กรณีแย่สุด" = ไม่เรียก
 */
type Chain = Map<string, Promise<unknown>>;
function chains(): Chain {
  const g = globalThis as unknown as { __sbAiChains?: Chain };
  return (g.__sbAiChains ??= new Map());
}

export async function withAiLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const map = chains();
  const prev = map.get(orgId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  map.set(orgId, tail);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (map.get(orgId) === tail) map.delete(orgId);
  }
}

/** ภาษาไทย ~1 token ต่อ 1.2 ตัวอักษร (เผื่อสูงไว้) — ใช้ประมาณ "กรณีแย่สุด" เท่านั้น ค่าจริงใช้ token ที่ OpenAI นับ */
export const tokensOf = (chars: number) => Math.ceil(chars / 1.2);

export function worstCaseThb(price: { input: number; output: number }, inputChars: number, maxOutputTokens: number, thbPerUsd: number): number {
  return ((tokensOf(inputChars) * price.input + maxOutputTokens * price.output) / 1_000_000) * thbPerUsd;
}
