import { NextResponse, type NextRequest } from "next/server";
import { cronDailySync, cronHalfMonth, cronWeekly } from "@/modules/ads/data/cron";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron ของโมดูล Google Ads Report (spec §3.1 / §6.6) — crontab บนเครื่องเป็นคนกำหนดเวลา:
 *   0 6 * * *     ?task=sync        ซิงค์ย้อนหลัง 30 วันทุกบัญชี
 *   0 7 * * 1     ?task=weekly      AI สรุป 7 วันล่าสุด + ส่งอีเมล
 *   0 7 1,16 * *  ?task=half-month  AI รายงานรอบครึ่งเดือน (&force=1 = ทดสอบวันอื่นได้)
 * กันด้วย CRON_SECRET เหมือน /api/cron/maintenance
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("CRON_SECRET is not configured", { status: 503 });
    }
  } else {
    const auth = req.headers.get("authorization");
    const key = url.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const task = url.searchParams.get("task") ?? "sync";
  const result: Record<string, unknown> = { ok: true, task };
  if (task === "sync") Object.assign(result, await cronDailySync());
  else if (task === "weekly") Object.assign(result, await cronWeekly());
  else if (task === "half-month") Object.assign(result, await cronHalfMonth(url.searchParams.get("force") === "1"));
  else return NextResponse.json({ ok: false, error: `ไม่รู้จัก task=${task}` }, { status: 400 });

  return NextResponse.json(result);
}
