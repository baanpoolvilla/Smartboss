import { extractMentionedIds, mentionMarkersToPlainText } from "@/modules/report_task/lib/report-feed-rich-text";
import type { ReportPost, ReportPostImage, ReportPostReply, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { TaskSource } from "@/modules/report_task/types";

const MAX_TITLE = 100;
const MAX_FILES = 10;
const LEADING_MENTIONS = /^(\s*@\[[^\]]+\]\((?:user|dept|everyone|role):[^)]+\))+\s*/;

export interface ReportTaskPrefill {
  title: string;
  description: string;
  assigneeIds: string[];
  source: TaskSource;
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "";
}

/** โพสต์ทั้งก้อนเป็นข้อความอ่านง่าย — ห้อง Openchat เก็บข้อความเต็มไว้ใน title จึงต้องเก็บ title ที่ยาวเกินหัวเรื่องไว้ด้วย */
function postBodyText(post: ReportPost): string {
  const title = mentionMarkersToPlainText(post.title).trim();
  const parts = title !== firstLine(title) || title.length > MAX_TITLE ? [title] : [];
  for (const s of post.sections ?? []) {
    const bullets = s.bullets.map((b) => mentionMarkersToPlainText(b).trimEnd()).filter((b) => b.trim());
    if (!s.heading.trim() && bullets.length === 0) continue;
    parts.push([s.heading.trim(), ...bullets].filter(Boolean).join("\n"));
  }
  return parts.join("\n\n");
}

/** คนที่ถูกแท็กในข้อความก่อน · ไม่มีใครถูกแท็ก = คนเขียน · ไม่รวมตัวเอง — แก้ได้ก่อนกดสร้าง */
function suggestAssignees(text: string, authorId: string, meId: string, isKnownUser: (id: string) => boolean): string[] {
  const tagged = extractMentionedIds(text, "user").filter((id) => id !== meId && isKnownUser(id));
  if (tagged.length > 0) return tagged;
  return authorId !== meId && isKnownUser(authorId) ? [authorId] : [];
}

export function buildReportTaskPrefill(input: {
  topic: Pick<ReportTopic, "id" | "name">;
  post: ReportPost;
  reply?: ReportPostReply;
  meId: string;
  nameOf: (userId: string) => string | undefined;
  isKnownUser: (userId: string) => boolean;
}): ReportTaskPrefill {
  const { topic, post, reply, meId, nameOf, isKnownUser } = input;
  const authorId = reply ? reply.authorId : post.authorId;
  const author = nameOf(authorId) ?? "สมาชิก";
  const createdAt = reply ? reply.createdAt : post.createdAt;
  const when = new Date(createdAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const postTitle = mentionMarkersToPlainText(post.title).trim();

  const body = reply ? mentionMarkersToPlainText(reply.body).trim() : postBodyText(post);
  // แท็กนำหน้าไม่เอาขึ้นชื่องาน (ไปอยู่ที่ผู้รับผิดชอบแล้ว) — ในรายละเอียดยังเห็นครบ
  const headline = firstLine(mentionMarkersToPlainText((reply ? reply.body : post.title).replace(LEADING_MENTIONS, "")).trim());
  const footer = [`— จากรีพอต "${topic.name}" · ${author} · ${when}`, reply && postTitle ? `โพสต์: ${firstLine(postTitle).slice(0, MAX_TITLE)}` : ""]
    .filter(Boolean)
    .join("\n");
  const rawText = reply ? reply.body : [post.title, ...(post.sections ?? []).flatMap((s) => s.bullets)].join("\n");

  return {
    title: headline.slice(0, MAX_TITLE) || `งานจากรีพอต ${topic.name}`,
    description: `${body}${body ? "\n\n" : ""}${footer}`,
    assigneeIds: suggestAssignees(rawText, authorId, meId, isKnownUser),
    source: {
      kind: reply ? "report_reply" : "report_post",
      label: `รีพอต "${topic.name}" · ${reply ? "ความคิดเห็น" : "โพสต์"}ของ ${author}`,
      link: `/chat-report/report-feed?topic=${encodeURIComponent(topic.id)}&post=${encodeURIComponent(post.id)}${reply ? `&reply=${encodeURIComponent(reply.id)}` : ""}`,
    },
  };
}

/** รูป/วิดีโอในข้อความ → File สำหรับแนบในงาน (สติกเกอร์ไม่เอา · ดึงไม่ได้ก็ข้าม ไม่ล้มทั้งหมด) */
export async function fetchReportImageFiles(images: ReportPostImage[]): Promise<File[]> {
  const list = images.filter((img) => !img.sticker && (img.url || img.dataUrl)).slice(0, MAX_FILES);
  const out = await Promise.all(
    list.map(async (img) => {
      try {
        const res = await fetch(img.url ?? img.dataUrl!);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new File([blob], img.name || "ไฟล์จากรีพอต", { type: img.mime || blob.type });
      } catch {
        return null;
      }
    })
  );
  return out.filter((f): f is File => f !== null);
}
