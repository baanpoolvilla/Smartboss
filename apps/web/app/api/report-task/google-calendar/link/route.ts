import type { NextRequest } from "next/server";
import ical from "node-ical";
import { requireOrg } from "@smartboss/auth";
import { addIcsLink, removeIcsLink, updateIcsLink, type IcsLinkTarget } from "@/modules/report_task/lib/db/ics-link-repo";
import { assertPublicHttpsUrl } from "@/modules/report_task/lib/ssrf-guard";

export const dynamic = "force-dynamic";

// Not locked to Google specifically — Outlook, Apple/iCloud, and most other
// calendar apps all expose the same kind of "secret .ics feed" link, and
// node-ical parses the standard iCal format regardless of who issued it.
// `assertPublicHttpsUrl` requires https AND blocks private/internal
// addresses, so this can't be used to probe the internal network (SSRF).

function guessLabel(url: string): string {
  if (/calendar\.google\.com/.test(url)) return "Google Calendar";
  if (/outlook\.(office365|office|live)\.com/.test(url)) return "Outlook";
  if (/icloud\.com/.test(url)) return "Apple / iCloud";
  // Unrecognized provider — show the domain instead of a generic label, so
  // connecting several "other" sources still lets you tell them apart in the list.
  try {
    return `ปฏิทินจาก ${new URL(url).hostname}`;
  } catch {
    return "ปฏิทินอื่น ๆ";
  }
}

function parseTarget(value: unknown): IcsLinkTarget | null {
  return value === "work" || value === "schedule" ? value : null;
}

export async function POST(request: NextRequest) {
  // เจ้าของลิงก์คือคนที่ล็อกอินอยู่เสมอ ไม่ใช่ userId ที่ client ส่งมา
  const session = await requireOrg();
  const userId = session.userId;
  const body = await request.json().catch(() => null);
  const url = (body?.url as string | undefined)?.trim();
  const label = (body?.label as string | undefined)?.trim();
  const target = parseTarget(body?.target) ?? "work";
  const shared = typeof body?.shared === "boolean" ? (body.shared as boolean) : true;
  if (!url) {
    return Response.json({ error: "ต้องระบุลิงก์" }, { status: 400 });
  }
  try {
    await assertPublicHttpsUrl(url);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "ลิงก์ไม่ถูกต้อง" }, { status: 400 });
  }
  try {
    // Validate it's actually reachable and parses as a calendar before
    // saving — catches a mistyped/expired link immediately instead of
    // failing silently on the next background sync.
    await ical.async.fromURL(url);
  } catch {
    return Response.json({ error: "เปิดลิงก์นี้ไม่ได้ ตรวจสอบว่าคัดลอกมาถูกต้อง" }, { status: 400 });
  }
  const entry = await addIcsLink(session.orgId, userId, url, label || guessLabel(url), target, shared);
  return Response.json({ ok: true, link: entry });
}

export async function PATCH(request: NextRequest) {
  const session = await requireOrg();
  const userId = session.userId;
  const body = await request.json().catch(() => null);
  const linkId = body?.linkId as string | undefined;
  const target = parseTarget(body?.target);
  const visible = typeof body?.visible === "boolean" ? (body.visible as boolean) : undefined;
  if (!linkId || (!target && visible === undefined)) {
    return Response.json({ error: "ต้องระบุ linkId และ target หรือ visible" }, { status: 400 });
  }
  await updateIcsLink(session.orgId, userId, linkId, { ...(target && { target }), ...(visible !== undefined && { visible }) });
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await requireOrg();
  const linkId = request.nextUrl.searchParams.get("linkId");
  if (!linkId) return Response.json({ error: "ต้องระบุ linkId" }, { status: 400 });
  await removeIcsLink(session.orgId, session.userId, linkId);
  return Response.json({ ok: true });
}
