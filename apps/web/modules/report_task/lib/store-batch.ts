"use client";

/**
 * รวมการโหลดครั้งแรกของ ServerStoreSync หลายตัวเป็นคำขอเดียว (GET /api/report-task/stores)
 *
 * ทุกตัวที่ mount พร้อมกัน (เข้าโมดูล) เรียก batchRead ใน effect รอบเดียวกัน — เก็บคีย์ไว้แล้วส่งรวด
 * เดียวหลังจบรอบนั้น (setTimeout 0) แทนยิง ~25 คำขอพร้อมกัน
 * ได้ null = ไม่ได้ผลจากทางนี้ (คำขอพัง/คีย์นั้นอ่านพลาด) — ผู้เรียกอ่านแบบเดิมรายคีย์ต่อเอง
 */
type Result = { slice: unknown; version: number | null } | null;

let queue: { key: string; resolve: (r: Result) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  const batch = queue;
  queue = [];
  timer = null;
  const keys = [...new Set(batch.map((b) => b.key))];
  let stores: Record<string, { data: unknown; version: number }> = {};
  try {
    const res = await fetch(`/api/report-task/stores?keys=${encodeURIComponent(keys.join(","))}`, { cache: "no-store" });
    if (res.ok) stores = ((await res.json()) as { stores?: typeof stores }).stores ?? {};
  } catch {
    // เน็ตสะดุด — ทุกตัวย้อนไปอ่านรายคีย์เอง
  }
  for (const { key, resolve } of batch) {
    const hit = stores[key];
    resolve(hit ? { slice: hit.data ?? null, version: Number(hit.version) || null } : null);
  }
}

export function batchRead(key: string): Promise<Result> {
  return new Promise((resolve) => {
    queue.push({ key, resolve });
    if (!timer) timer = setTimeout(() => void flush(), 0);
  });
}
