import "server-only";

import { publishToUsers } from "@/lib/realtime/server";
import { sendWebPush } from "@/lib/web-push";

/**
 * ประกาศแจ้งเตือนใหม่ของ "ทุกโมดูล" ให้ผู้รับรู้ทันที — ใช้คู่กับการบันทึกลงกระดิ่งเสมอ
 * (กระดิ่งยังเป็นที่เก็บหลัก ตัวนี้แค่ทำให้เด้ง/มีเสียง)
 *
 *  - กำลังดูเว็บอยู่ → ส่งทางท่อสด ({ type: "notify.new" }) หน้าเว็บเล่นเสียง + เด้งกล่อง +
 *    รีเฟรชกระดิ่ง (components/shell/system-notify.tsx)
 *  - เครื่องอื่นของคนเดียวกันที่ไม่ได้ดูหน้าจอ (ปิดเว็บ/ย่อ/ล็อกจอ) → Web Push พร้อมเสียงของเครื่อง
 *    (ตัดสินรายเครื่องใน sendWebPush — ดูในคอมอยู่ มือถือก็ยังเด้ง)
 *
 * ไม่ throw — แจ้งเตือนเด้งพลาดต้องไม่ทำให้งานหลัก (บันทึกใบงาน/อนุมัติลา ฯลฯ) พลาดตาม
 */
export async function announceNotification(
  orgId: string,
  userIds: string[],
  input: { title: string; body?: string | null; url?: string | null; tag?: string }
): Promise<void> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return;
  try {
    const url = input.url ?? "/notifications";
    publishToUsers(ids, { type: "notify.new", title: input.title, body: input.body ?? "", url });
    await sendWebPush(orgId, ids, { title: input.title, body: input.body ?? undefined, url, tag: input.tag });
  } catch (err) {
    console.error("[notify-push] announce failed", err);
  }
}
