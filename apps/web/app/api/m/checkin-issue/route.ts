import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@smartboss/auth";

import { CHECKIN_PROBLEMS, type CheckinProblem } from "@/modules/hr/lib/checkin-issue";
import { listIssueStaff } from "@/modules/admin/data/issue-staff";
import { notifyActorName, notifyUser } from "@/modules/maintenance/data/notify";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { migrateIssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import { defaultPriorityFor, nextTicketCode } from "@/modules/report_task/lib/issue-meta";
import type { IssueTicket } from "@/modules/report_task/types/issue";

/**
 * "ลงเวลาไม่ได้? แจ้งไอที" — สร้างตั๋วในระบบแจ้งปัญหาเดิม (store "issue-reports" ของบริษัท ที่ทีมไอที
 * เห็นในคอนโซล /admin/issue-reports) แล้วแจ้งเตือนทีมรับเรื่องทันที
 *
 * ทำที่เซิร์ฟเวอร์ ไม่ใช่ addTicket ฝั่ง client เหมือนปุ่มแจ้งบัคบนแถบบน เพราะหน้าลงเวลาเปิดได้ใน
 * LINE Mini App (/m) ที่ไม่มี ServerStoreSync ของ store นี้ — และคนที่ลงเวลาไม่ได้มักอยู่หน้างาน เน็ตไม่ดี
 * ยิงคำขอเดียวจบดีกว่า · แนบข้อความ error/ความแม่นของ GPS/เครื่องให้เอง คนแจ้งไม่ต้องพิมพ์
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  problem: z.enum(Object.keys(CHECKIN_PROBLEMS) as [CheckinProblem, ...CheckinProblem[]]),
  note: z.string().trim().max(500).optional().default(""),
  lastMessage: z.string().trim().max(400).nullable().optional(),
  accuracyM: z.number().nonnegative().nullable().optional(),
  pageUrl: z.string().max(500).optional().default(""),
  userAgent: z.string().max(500).optional().default(""),
  viewport: z.string().max(40).optional().default(""),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.orgId) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const input = parsed.data;
  const orgId = session.orgId;
  const now = new Date().toISOString();

  const title = `ลงเวลาไม่ได้: ${CHECKIN_PROBLEMS[input.problem]}`;
  const lines = [
    `ปัญหา: ${CHECKIN_PROBLEMS[input.problem]}`,
    input.lastMessage ? `ข้อความที่ขึ้นบนหน้าลงเวลา: ${input.lastMessage}` : null,
    typeof input.accuracyM === "number" ? `ความแม่นของ GPS ตอนกด: ±${Math.round(input.accuracyM)} ม.` : null,
    input.note ? `รายละเอียดเพิ่ม: ${input.note}` : null,
  ].filter((l): l is string => !!l);
  const description = lines.join("\n");

  // ต่อท้ายตั๋วของบริษัท — มีคนเขียน store พร้อมกัน (version ไม่ตรง) ก็อ่านใหม่แล้วลองอีกครั้ง
  let ticket: IssueTicket | null = null;
  for (let attempt = 0; attempt < 4 && !ticket; attempt++) {
    const { data, version } = await readStore<unknown>(orgId, "issue-reports");
    const slice = migrateIssueStoreSlice(data);
    const draft: IssueTicket = {
      id: `issue-${crypto.randomUUID()}`,
      code: nextTicketCode(slice.tickets.length),
      reporterId: session.userId,
      category: "bug",
      title,
      description,
      impact: "blocked",
      status: "new",
      priority: defaultPriorityFor("blocked", "bug"),
      assigneeId: null,
      vendorAssigneeId: null,
      visibility: "private",
      shareWithHead: false,
      context: {
        pageUrl: input.pageUrl,
        userAgent: input.userAgent || (request.headers.get("user-agent") ?? ""),
        viewport: input.viewport,
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
        occurredAt: now,
      },
      attachments: [],
      messages: [
        {
          id: `${crypto.randomUUID()}-msg-0`,
          kind: "message",
          authorId: session.userId,
          audience: "all",
          body: description,
          attachments: [],
          createdAt: now,
          editedAt: null,
          readBy: [session.userId],
        },
        {
          id: `${crypto.randomUUID()}-evt-0`,
          kind: "event",
          authorId: session.userId,
          audience: "all",
          body: "รอทีมดูแลระบบรับเรื่อง",
          event: { type: "status_changed", to: "new" },
          attachments: [],
          createdAt: now,
          editedAt: null,
          readBy: [session.userId],
        },
      ],
      duplicateOfId: null,
      rejectReason: null,
      tags: ["ลงเวลา"],
      whatWasChecked: null,
      createdAt: now,
      firstResponseAt: null,
      escalatedAt: null,
      escalatedBy: null,
      resolvedAt: null,
      closedAt: null,
      updatedAt: now,
      reopenCount: 0,
      satisfaction: null,
    };
    const saved = await writeStore(
      orgId,
      "issue-reports",
      { ...slice, tickets: [draft, ...slice.tickets] },
      data === null ? null : version,
      session.userId
    );
    if (saved.ok) ticket = draft;
  }
  if (!ticket) return NextResponse.json({ error: "ส่งเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 503 });

  // แจ้งทีมรับเรื่อง (เหมือน notifyNewIssueTicket) — แจ้งพลาดไม่ทำให้ตั๋วที่บันทึกแล้วพังตาม
  try {
    const [staff, reporter] = await Promise.all([listIssueStaff(), notifyActorName(session.userId)]);
    await Promise.all(
      staff.map((u) =>
        notifyUser(orgId, u.id, {
          title: reporter ? `${reporter} ลงเวลาไม่ได้ (${ticket.code})` : `มีคนลงเวลาไม่ได้ (${ticket.code})`,
          body: description,
          type: "issue_ticket_new",
          referenceId: `${orgId}:${ticket.id}`,
        })
      )
    );
  } catch (err) {
    console.error("[checkin-issue] notify failed", err);
  }

  return NextResponse.json({ ok: true, code: ticket.code, id: ticket.id });
}
