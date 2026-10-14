import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@smartboss/auth";

import { verifyCheckinAttempt, type CheckinAttempt } from "@/modules/hr/lib/checkin-attempt-proof";
import { listIssueStaff } from "@/modules/admin/data/issue-staff";
import { notifyActorName, notifyUser } from "@/modules/maintenance/data/notify";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { migrateIssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import { defaultPriorityFor, nextTicketCode } from "@/modules/report_task/lib/issue-meta";
import type { IssueTicket } from "@/modules/report_task/types/issue";

/**
 * "ลงเวลาไม่ได้ · แจ้งไอที" — สร้างตั๋วในระบบแจ้งปัญหาเดิม (store "issue-reports" ของบริษัท ที่ทีมไอที
 * เห็นในคอนโซล /admin/issue-reports) แล้วแจ้งเตือนทีมรับเรื่องทันที
 *
 * ทำที่เซิร์ฟเวอร์ ไม่ใช่ addTicket ฝั่ง client เหมือนปุ่มแจ้งบัคบนแถบบน เพราะหน้าลงเวลาเปิดได้ใน
 * LINE Mini App (/m) ที่ไม่มี ServerStoreSync ของ store นี้ — และคนที่ลงเวลาไม่ได้มักอยู่หน้างาน เน็ตไม่ดี
 * ยิงคำขอเดียวจบดีกว่า
 *
 * กดปุ่มเดียว ไม่ให้เลือกปัญหา — ไอทีตรวจสาเหตุเอง ("กดแค่ลงเวลาไม่ได้พอ เดี๋ยวไอทีเช็คเอง")
 * แต่ต้องมีหลักฐานว่ากดลงเวลาจริง: แนบใบยืนยันการกดที่ไม่ผ่านซึ่งเซิร์ฟเวอร์ลงลายเซ็นไว้
 * (checkin-attempt-proof.ts — เวลาเซิร์ฟเวอร์ พิกัด เหตุผล แก้ไม่ได้) + ตำแหน่งตอนกดแจ้ง + เวลาที่แจ้ง
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** ใบยืนยันการกดที่ไม่ผ่านจาก api/m/checkin */
  proofs: z.array(z.string().max(4000)).max(5).optional().default([]),
  lastMessage: z.string().trim().max(400).nullable().optional(),
  /** ตำแหน่งตอนกดแจ้ง — จากเครื่อง (ไม่ได้เซ็น) ใช้ประกอบ */
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracyM: z.number().nonnegative().nullable().optional(),
  pageUrl: z.string().max(500).optional().default(""),
  userAgent: z.string().max(500).optional().default(""),
  viewport: z.string().max(40).optional().default(""),
});

const INTENT_LABEL: Record<CheckinAttempt["intent"], string> = { CLOCK_IN: "เข้างาน", CLOCK_OUT: "ออกงาน", AUTO: "ลงเวลา" };

function thaiTime(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" });
}

/** " · พิกัด 13.12345,100.12345 ±18 ม. · แผนที่ https://..." */
function placeText(latitude: number | null, longitude: number | null, accuracyM: number | null): string {
  if (latitude === null || longitude === null) return " · ไม่ได้รับตำแหน่ง GPS";
  const accuracy = accuracyM === null ? "" : ` ±${Math.round(accuracyM)} ม.`;
  const at = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  return ` · พิกัด ${at}${accuracy} · แผนที่ https://maps.google.com/?q=${at}`;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.orgId) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const input = parsed.data;
  const orgId = session.orgId;
  const now = new Date().toISOString();

  const attempts = input.proofs
    .map((token) => verifyCheckinAttempt(token, session.userId))
    .filter((a): a is CheckinAttempt => a !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const rejectedProofs = input.proofs.length - attempts.length;

  const title = attempts.length > 0 ? `ลงเวลาไม่ได้ (กดแล้ว ${attempts.length} ครั้ง)` : "ลงเวลาไม่ได้";
  const description = [
    "พนักงานกดลงเวลาไม่ได้ — รบกวนไอทีตรวจสาเหตุ",
    "",
    attempts.length > 0
      ? "หลักฐานการกดลงเวลา (เซิร์ฟเวอร์บันทึกและลงลายเซ็นไว้ เวลาเป็นเวลาเซิร์ฟเวอร์ แก้ไขไม่ได้):"
      : "ไม่มีบันทึกการกดลงเวลาจากเครื่องนี้ (อาจกดปุ่มไม่ได้เลย หน้าค้าง หรือเน็ตไม่ถึงเซิร์ฟเวอร์)",
    ...attempts.map(
      (a) => `• ${thaiTime(a.at)} กด${INTENT_LABEL[a.intent]} — ${a.reason}${placeText(a.latitude, a.longitude, a.accuracyM)}`
    ),
    rejectedProofs > 0 ? `⚠ มีใบยืนยัน ${rejectedProofs} ใบที่ตรวจลายเซ็นไม่ผ่านหรือหมดอายุ ไม่ได้นับ` : null,
    "",
    `เวลาที่กดแจ้ง (เซิร์ฟเวอร์): ${thaiTime(now)}`,
    `ตำแหน่งตอนกดแจ้ง (จากเครื่อง)${placeText(input.latitude ?? null, input.longitude ?? null, input.accuracyM ?? null)}`,
    input.lastMessage ? `ข้อความที่ขึ้นบนหน้าลงเวลาล่าสุด: ${input.lastMessage}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

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

  // แจ้งทีมรับเรื่อง (เหมือน notifyNewIssueTicket) — แจ้งพลาดไม่ทำให้ตั๋วที่บันทึกแล้วพังตาม · หลักฐานเต็มอยู่ในตั๋ว
  try {
    const [staff, reporter] = await Promise.all([listIssueStaff(), notifyActorName(session.userId)]);
    const last = attempts[attempts.length - 1];
    await Promise.all(
      staff.map((u) =>
        notifyUser(orgId, u.id, {
          title: reporter ? `${reporter} ลงเวลาไม่ได้ (${ticket.code})` : `มีคนลงเวลาไม่ได้ (${ticket.code})`,
          body: last ? `กดไม่ผ่าน ${attempts.length} ครั้ง · ล่าสุด ${thaiTime(last.at)}` : "ไม่มีบันทึกการกดจากเครื่องนี้",
          type: "issue_ticket_new",
          referenceId: `${orgId}:${ticket.id}`,
        })
      )
    );
  } catch (err) {
    console.error("[checkin-issue] notify failed", err);
  }

  return NextResponse.json({ ok: true, code: ticket.code, id: ticket.id, attempts: attempts.length, reportedAt: now });
}
