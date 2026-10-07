import "server-only";
import { prisma } from "@smartboss/database";

import { wfFetch } from "@/modules/hr/lib/api";
import { eventSourceLabel, formatTime } from "@/modules/hr/lib/labels";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { eventDay } from "@/lib/performance";

/**
 * "หักจากอะไร" ของแต่ละรายการในหน้า "คะแนนของฉัน" — กดรายการแล้วเห็นต้นเรื่อง
 * ("เวลาโดนหักอะไรให้กดเข้าไปแล้วรู้ได้ด้วยว่าหักจากอะไร")
 *
 *  - มาสาย/ขาดงาน: เวลาที่สแกนจริงของวันนั้น (เข้า/ออก · ช่องทาง) จากระบบลงเวลา
 *  - รายงานไม่ส่ง/ส่งสาย: ห้องไหน รอบไหน ปิดรอบกี่โมง + ลิงก์ไปห้องนั้น
 *  - งาน: ลิงก์ไปงานนั้น
 *  - ทุกแบบ: ระบบหักอัตโนมัติ หรือใครกดหัก
 *
 * อ่านไม่ได้ (ระบบบุคคลล่ม ฯลฯ) = ไม่มีบรรทัดนั้น หน้าคะแนนยังขึ้นตามปกติ
 */

export interface EventDetail {
  lines: string[];
  href?: string;
  hrefLabel?: string;
}

interface DetailEvent {
  id: string;
  category: string;
  occurredAt: Date;
  refType: string | null;
  refId: string | null;
  createdBy?: string | null;
}

interface TimeEvent {
  employment_id: string;
  captured_at: string;
  event_intent: string;
  source_type: string;
}

const INTENT: Record<string, string> = { CLOCK_IN: "เข้า", CLOCK_OUT: "ออก" };

/** สแกนทั้งหมดของ "ตัวเอง" ในวันที่ขอ — ใช้ token ของผู้ใช้ที่ล็อกอินอยู่ จึงเห็นได้แค่ของตัวเอง */
async function myScansByDay(days: string[]): Promise<Map<string, TimeEvent[]>> {
  const out = new Map<string, TimeEvent[]>();
  if (days.length === 0) return out;
  try {
    const me = await wfFetch<{ employment_id: string | null }>("/me");
    if (!me.employment_id) return out;
    await Promise.all(
      days.map(async (day) => {
        const res = await wfFetch<{ items: TimeEvent[] }>(`/time-events?date=${day}`).catch(() => null);
        if (!res) return;
        out.set(
          day,
          res.items
            .filter((e) => e.employment_id === me.employment_id)
            .sort((a, b) => a.captured_at.localeCompare(b.captured_at)),
        );
      }),
    );
  } catch {
    // ระบบบุคคลอ่านไม่ได้ — ไม่มีรายละเอียดเวลาสแกน
  }
  return out;
}

export async function buildMyEventDetails(orgId: string, events: DetailEvent[]): Promise<Map<string, EventDetail>> {
  const details = new Map<string, EventDetail>();
  const attendanceDays = [
    ...new Set(events.filter((e) => e.refType === "attendance_day").map((e) => eventDay(e.occurredAt))),
  ];
  const needTopics = events.some((e) => e.refType === "report_round");
  const actorIds = [...new Set(events.map((e) => e.createdBy).filter((x): x is string => Boolean(x)))];

  const [scans, topics, actors] = await Promise.all([
    myScansByDay(attendanceDays),
    needTopics
      ? readStore<{ topics: ReportTopic[] }>(orgId, "report-feed")
          .then((r) => r.data?.topics ?? [])
          .catch(() => [] as ReportTopic[])
      : Promise.resolve([] as ReportTopic[]),
    actorIds.length > 0
      ? prisma.user.findMany({ where: { orgId, id: { in: actorIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const topicById = new Map(topics.map((t) => [t.id, t] as const));
  const actorName = new Map(actors.map((a) => [a.id, a.name] as const));

  for (const e of events) {
    const lines: string[] = [];
    let href: string | undefined;
    let hrefLabel: string | undefined;

    if (e.refType === "attendance_day") {
      const list = scans.get(eventDay(e.occurredAt));
      if (list === undefined) {
        lines.push("ข้อมูลจากระบบลงเวลา (ตอนนี้อ่านเวลาสแกนไม่ได้)");
      } else if (list.length === 0) {
        lines.push("ไม่พบการสแกนเข้า/ออกของวันนั้น");
      } else {
        lines.push(
          `เวลาที่สแกน: ${list
            .map((s) => `${formatTime(s.captured_at)}${INTENT[s.event_intent] ? ` ${INTENT[s.event_intent]}` : ""} (${eventSourceLabel(s.source_type)})`)
            .join(" · ")}`,
        );
        lines.push("เทียบสแกนแรกของวันกับเวลาเข้ากะ หลังหักเวลาผ่อนผันตามนโยบายบริษัท");
      }
    } else if (e.refType === "report_round" && e.refId) {
      const [day, topicId, roundId] = e.refId.split(":");
      const topic = topicId ? topicById.get(topicId) : undefined;
      const round = topic ? effectiveRoundsOf(topic).find((r) => r.id === roundId) : undefined;
      lines.push(
        `ห้อง ${topic?.name ?? "(ห้องถูกลบแล้ว)"} · รอบ ${round?.label ?? "-"}${round?.time ? ` (ปิดรอบ ${round.time} น.)` : ""}${day ? ` · วันที่ ${day}` : ""}`,
      );
      if (topic) {
        href = `/chat-report/report-feed?topic=${topic.id}`;
        hrefLabel = "เปิดห้อง →";
      }
    } else if ((e.refType === "task" || e.refType === "task_reaction") && e.refId) {
      if (e.refType === "task") {
        href = `/report-task/tasks?task=${e.refId.split(":")[0]}`;
        hrefLabel = "เปิดงาน →";
      }
    }

    lines.push(e.createdBy ? `หักโดย ${actorName.get(e.createdBy) ?? "ผู้ดูแล"}` : "ระบบหักอัตโนมัติ");
    details.set(e.id, { lines, href, hrefLabel });
  }
  return details;
}
