"use client";

/**
 * "ยังมีของในเครื่องที่ยังไม่ถึงเซิร์ฟเวอร์ไหม" — ที่เดียวให้ทุกส่วนของแอปถามได้ก่อนโหลดหน้าใหม่
 *
 * ข้อมูลที่แชร์กันทั้งทีม (ฟีดรายงาน, งาน ฯลฯ) บันทึกแบบหน่วง 0.5 วิ แล้วส่งทั้งก้อน (ฟีดรายงานหลาย MB)
 * ตอนหลายคนส่งพร้อมกันยังต้องรวมแล้วส่งซ้ำอีกหลายรอบ ⇒ ระหว่าง "กดโพสต์" กับ "ถึงเซิร์ฟเวอร์" มีช่วงเป็นวินาที
 * ถ้าหน้าถูกโหลดใหม่ในช่วงนั้น โพสต์หายเงียบ ๆ — ตอนปิดหน้าส่งตามไปไม่ได้ (keepalive รับได้ ~64KB)
 * (เจอจริง: deploy เสร็จพอดี แอปโหลดหน้าใหม่ให้เองตอนคนเพิ่งกดส่งรีพอต โพสต์ไม่ขึ้นเลย)
 */

const probes = new Map<string, () => boolean>();
let guardInstalled = false;

/** ลงทะเบียนตัวตอบ "มีของค้างไหม" ของตัวบันทึกหนึ่งตัว — คืนฟังก์ชันถอนทะเบียน */
export function registerSyncProbe(key: string, isPending: () => boolean): () => void {
  probes.set(key, isPending);
  if (!guardInstalled && typeof window !== "undefined") {
    guardInstalled = true;
    // ปิดแท็บ/กดรีเฟรชระหว่างที่ยังบันทึกไม่เสร็จ — ให้เบราว์เซอร์ถามก่อน (ข้อความเป็นของเบราว์เซอร์เอง)
    window.addEventListener("beforeunload", (event) => {
      if (!hasPendingSync()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }
  return () => {
    if (probes.get(key) === isPending) probes.delete(key);
  };
}

export function hasPendingSync(): boolean {
  for (const isPending of probes.values()) if (isPending()) return true;
  return false;
}

/** รอจนบันทึกครบ (หรือครบเวลา) — ใช้ก่อนโหลดหน้าใหม่ที่ผู้ใช้สั่งเอง */
export async function whenSyncIdle(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (hasPendingSync() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}
