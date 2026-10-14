import type { ReportPost } from "@/modules/report_task/store/report-feed-store";

/**
 * ส่งรีพอตย้อนหลังหลัง CEO อนุมัติ — "อนุมัติแล้วให้คนนั้นไปส่งรีพอต" คะแนนคืนเมื่อส่งจริงเท่านั้น
 *
 * โพสต์ที่ส่งผ่านปุ่ม "ส่งย้อนหลัง" มี `retroFor` ⇒ รอบของวันนั้นนับว่าส่งแล้ว (คืนเต็ม −2 → 0)
 * ใช้ทั้งแดชบอร์ด (report-feed-compliance.ts) และตัวหักคะแนน (report-penalty-sweep.ts) ให้ตัดสินตรงกัน
 * ฝั่งเซิร์ฟเวอร์กรองโพสต์ที่ไม่ตรงกับคำร้องที่อนุมัติจริงออกก่อน (acceptRetroPosts) — ปลอม retroFor เองไม่ได้ผล
 */
export function hasRetroSubmission(posts: ReportPost[], topicId: string, userId: string, roundId: string, day: string): boolean {
  return posts.some(
    (p) => !!p.retroFor && p.topicId === topicId && p.authorId === userId && p.retroFor.roundId === roundId && p.retroFor.day === day
  );
}
