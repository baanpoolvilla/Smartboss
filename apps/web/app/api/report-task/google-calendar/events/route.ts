import type { NextRequest } from "next/server";
import ical from "node-ical";
import { requireOrg } from "@smartboss/auth";
import { getAllIcsLinks } from "@/modules/report_task/lib/db/ics-link-repo";

export const dynamic = "force-dynamic";

interface NormalizedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  sourceId: string;
  sourceLabel: string;
  ownerUserId: string;
  target: "work" | "schedule";
  /** Owner's choice: shared with the whole team, or private to just them. */
  shared: boolean;
  /** Shared by every instance expanded from the same recurring source event
   * (`${linkId}-${uid}`) — absent for a plain one-off event. Lets the client
   * recognize "these are the same weekly routine," not separate unrelated
   * events that merely repeat a similar title. */
  seriesId?: string;
}

export async function GET(request: NextRequest) {
  const session = await requireOrg();
  const { searchParams } = new URL(request.url);
  const timeMinStr = searchParams.get("timeMin");
  const timeMaxStr = searchParams.get("timeMax");
  // ผู้ดูคือคนที่ล็อกอินอยู่ ไม่ใช่ค่าที่ client ส่งมา — ต้นทางรับจาก query
  // string ซึ่งเดาเป็นใครก็ได้ ทำให้เห็นปฏิทินส่วนตัวของคนอื่นได้
  const viewerId = session.userId;
  if (!timeMinStr || !timeMaxStr) return Response.json({ error: "ต้องระบุช่วงเวลา (timeMin/timeMax)" }, { status: 400 });

  // Still fetch every connected calendar (a private one still needs to reach
  // its own owner) — filtering by `viewerId` happens below, per-event, before
  // anything is added to the response.
  const links = await getAllIcsLinks(session.orgId);

  const timeMin = new Date(timeMinStr);
  const timeMax = new Date(timeMaxStr);
  const events: NormalizedEvent[] = [];

  // Each link is fetched independently — one dead/expired feed shouldn't
  // take down the events for anyone else's connected calendars.
  await Promise.all(
    links
      .filter((link) => link.visible || link.ownerUserId === viewerId)
      .map(async (link) => {
      try {
        const data = await ical.async.fromURL(link.url);
        for (const raw of Object.values(data)) {
          if (!raw || raw.type !== "VEVENT") continue;
          const item = raw;
          if (!item.start || item.status === "CANCELLED") continue;
          const allDay = item.datetype === "date";
          const title = (item.summary as string | undefined)?.trim() || "(ไม่มีหัวข้อ)";

          if (item.rrule) {
            // Plain `rrule.between()` expands the *original* schedule only —
            // it doesn't know about RECURRENCE-ID overrides (an occurrence
            // moved to a different date/time) or EXDATE (an occurrence
            // removed outright), so a moved occurrence would show up twice:
            // once on its old date and once on its new one. node-ical's own
            // expander applies both, matching what the source calendar app
            // (Google/Outlook/etc.) actually shows.
            const instances = ical.expandRecurringEvent(item, { from: timeMin, to: timeMax });
            const seriesId = `${link.id}-${item.uid}`;
            for (const inst of instances) {
              const instTitle = (inst.summary as string | undefined)?.trim() || title;
              events.push({
                id: `${seriesId}-${inst.start.toISOString()}`,
                title: instTitle,
                start: inst.start.toISOString(),
                end: inst.end.toISOString(),
                allDay: inst.isFullDay,
                sourceId: link.id,
                sourceLabel: link.label,
                ownerUserId: link.ownerUserId,
                target: link.target,
                shared: link.visible,
                seriesId,
              });
            }
            continue;
          }

          const start = item.start;
          const end = item.end ?? item.start;
          if (end < timeMin || start > timeMax) continue;
          events.push({
            id: `${link.id}-${item.uid}`,
            title,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay,
            sourceId: link.id,
            sourceLabel: link.label,
            ownerUserId: link.ownerUserId,
            target: link.target,
            shared: link.visible,
          });
        }
      } catch {
        // Skip this one source; the rest still return normally.
      }
    })
  );

  return Response.json({ events });
}
