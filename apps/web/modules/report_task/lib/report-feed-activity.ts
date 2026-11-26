import { textMentionsUser } from "@/modules/report_task/lib/report-feed-mentions";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";

/**
 * How many unread items in this post are "about" `me` — the single shared
 * source for both the "รายงาน" nav badge (ReportActivityNavBadge) and the
 * per-room red pill in the topic sidebar, so the two never disagree. Counts,
 * each unread item at most once:
 *
 *   1. the post itself @mentions me and isn't my own post (mention read from
 *      `sections.bullets` — the exact text the store seeds `unreadFor` from);
 *   2. a reply someone else left on my own post (a comment on my report);
 *   3. a reply that @mentions me;
 *   4. a reply in a post I follow — I was tagged in the post, or commented /
 *      was tagged earlier in its replies (Facebook-style).
 *
 * A plain new post in a room I'm merely a member of is NOT "about me" — that
 * is ordinary unread, already carried by the sidebar's green notch + bold
 * label. Counting it here would make the red pill/badge never go quiet.
 */
export function aboutMeCountInPost(post: ReportPost, me: string, topic?: Pick<ReportTopic, "visibility">): number {
  let n = 0;
  const mine = post.authorId === me;

  // (1) post that @mentions me (directly or via "@ทุกคน"), still unread, not my own
  if (!mine && post.unreadFor.includes(me)) {
    const text = post.sections.flatMap((s) => s.bullets).join("\n");
    if (textMentionsUser(text, me, topic)) n++;
  }

  // (4) ติดตามโพสต์แบบเฟซบุ๊ก (ผู้ใช้ 26/11/2569): ถูกแท็กในโพสต์ หรือเคยคอมเมนต์/ถูกแท็กในคอมเมนต์ก่อนหน้า
  // ⇒ คอมเมนต์ที่คนอื่นคุยต่อหลังจากนั้นนับเป็นเรื่องของเราด้วย แม้ไม่ได้แท็กซ้ำ
  // นับเฉพาะแท็กตรงตัว/แผนก/@CEO (ไม่ส่ง topic = ไม่นับ @ทุกคน — ไม่งั้นโพสต์ประกาศ @ทุกคน ทำให้ทุกคอมเมนต์ขึ้นแดงทั้งห้อง)
  let following = !mine && post.sections.some((s) => s.bullets.some((b) => textMentionsUser(b, me)));

  // (2)+(3)+(4) replies: on my own post, a reply that @mentions me, or a
  // reply in a thread I follow — each unread reply counted once
  for (const r of post.replies) {
    if (r.authorId === me) {
      following = true;
      continue;
    }
    const mentionsMe = textMentionsUser(r.body, me, topic);
    if (r.unreadFor?.includes(me) && (mine || following || mentionsMe)) n++;
    if (mentionsMe && textMentionsUser(r.body, me)) following = true;
  }

  return n;
}
