import { NextResponse, type NextRequest } from "next/server";
import {
  dockOverdueMaintenance,
  generateWorkOrdersForDuePms,
  notifyDuePmSchedules,
  notifyMissingExpenses,
} from "@/modules/maintenance/data/cron";
import { dockAttendance, dockFinishedShifts, refundAttendanceDocks } from "@/lib/attendance-performance";
import { purgeExpiredChatMedia } from "@/modules/chat/data/media-retention";
import { notifyLateArrivals } from "@/lib/attendance-late-alerts";
import { postAttendanceToChat } from "@/lib/attendance-chat";
import { notifyPendingOvertime } from "@/modules/hr/lib/hr-notify";
import { syncPublicHolidays } from "@/lib/public-holiday-sync";
import { prisma } from "@smartboss/database";
import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";
import { runReportPenaltySweep } from "@/modules/report_task/lib/server/report-penalty-sweep-run";
import { runTaskPenaltySweep } from "@/modules/report_task/lib/server/task-penalty-sweep-run";

export const runtime = "nodejs";

/**
 * Cron ของโมดูลแจ้งซ่อมบำรุง (แทน DB trigger / RPC เดิมของ ChangYai)
 *   - สร้างใบงานจาก PM ที่ถึงกำหนด
 *   - แจ้งเตือน PM ใกล้ครบกำหนด (?task=pm-notify)
 *   - เตือนใบงานที่ยังไม่บันทึกค่าใช้จ่าย (?task=expense-reminder)
 *   - หักคะแนนงานที่ปล่อยค้าง + ผลลงเวลา (?task=performance) → หน้าสรุปรายคนของผู้บริหาร
 *   - ลบรูป/วิดีโอ/เสียงในแชทที่หมดอายุ ไม่อยู่ในอัลบั้ม (?task=chat-media, &dryRun=1 ดูอย่างเดียว)
 *   - แจ้งเตือนมาสายของวันนี้ ให้ตัวพนักงาน (?task=late-alerts — ต้องมีบรรทัด crontab แยก ทุก 5 นาทีช่วงเช้า ดู docs/deploy.md)
 *   - แจ้งผู้อนุมัติว่ามี OT ค้างรออนุมัติกี่รายการ (?task=ot-pending — วันละครั้ง อยู่ใน all ตอน 08:00)
 *   - เด้งเวลาเข้า/ออกงานเข้าห้องแชท "ระบบลงเวลา" ของแต่ละคน (?task=attendance-chat — crontab ทุกนาที
 *     แยกบรรทัด ดู docs/deploy.md · ไม่อยู่ใน all เพราะ all รันวันละครั้ง)
 *   - ดึงวันหยุดนักขัตฤกษ์จาก Google เข้าปฏิทินวันหยุดบริษัทของทุกบริษัท (?task=holidays — อยู่ใน all, &dryRun=1 ดูอย่างเดียว)
 *   - งานคะแนนรายชั่วโมง (?task=score-hourly — crontab แยกบรรทัด 59 * * * * · ไม่อยู่ใน all):
 *     หักคะแนนลงเวลาเมื่อกะจบ (กะปกติ/ไม่มีกะ ภายใน 23:59 · กะดึกหลังเลิกกะ 2 ชม.)
 *     + รอบหักคะแนนรายงาน/งานเลยกำหนดของทุกบริษัท ไม่ต้องรอให้มีคนเปิดเว็บ
 *   - รอบเก็บตกของวัน (?task=score-final — crontab 5 0 * * * · ไม่อยู่ใน all): เหมือน score-hourly + คืนคะแนนลงเวลา
 *     ที่ไม่ควรหักแล้ว ⇒ ของวันตัดรอบครบก่อนเกรดพร้อมใช้ 00:30 (score-period.ts scorePeriodReadyAt)
 *   - ?task=all รันทั้งหมด
 * เรียกด้วย header `Authorization: Bearer $CRON_SECRET` หรือ `?key=$CRON_SECRET`
 * route นี้อยู่นอก auth ของ proxy จึงกันด้วย CRON_SECRET เท่านั้น →
 * บน production ถ้าไม่ตั้ง secret ต้อง **ปิด** ไม่ใช่เปิดโล่ง (dev ยังเรียกได้เลย)
 */
/** รอบหักคะแนนรายงาน + งานเลยกำหนดของทุกบริษัท (ตัวเดียวกับที่แท็บที่เปิดอยู่เรียก) — ข้ามบริษัทที่เพิ่งรันไป */
async function runScoreSweepsAllOrgs() {
  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });
  const out = { orgs: orgs.length, reports: 0, tasks: 0, skipped: 0, errors: [] as string[] };
  for (const { id } of orgs) {
    for (const [name, run] of [
      ["reports", () => runReportPenaltySweep(id, null)],
      ["tasks", () => runTaskPenaltySweep(id, null)],
    ] as const) {
      if (!claimSweep(name, id)) {
        out.skipped++;
        continue;
      }
      try {
        await run();
        out[name]++;
      } catch (error) {
        console.error(`[cron] ${name} sweep`, id, error);
        out.errors.push(`${name}:${id}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        releaseSweep(name, id);
      }
    }
  }
  return out;
}

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

  const task = url.searchParams.get("task") ?? "work-orders";
  const result: Record<string, unknown> = { ok: true, task };

  if (task === "work-orders" || task === "all") {
    Object.assign(result, await generateWorkOrdersForDuePms());
  }
  if (task === "pm-notify" || task === "all") {
    Object.assign(result, await notifyDuePmSchedules());
  }
  if (task === "expense-reminder" || task === "all") {
    Object.assign(result, await notifyMissingExpenses());
  }
  if (task === "late-alerts" || task === "all") {
    Object.assign(result, { lateAlerts: await notifyLateArrivals() });
  }
  if (task === "attendance-chat") {
    Object.assign(result, { attendanceChat: await postAttendanceToChat() });
  }
  if (task === "chat-media" || task === "all") {
    Object.assign(result, { chatMedia: await purgeExpiredChatMedia({ dryRun: url.searchParams.get("dryRun") === "1" }) });
  }
  if (task === "score-hourly" || task === "attendance-shift-end" || task === "score-final") {
    // ทุกชั่วโมง (:59) — งานคะแนนทั้งหมดที่ต้องเสร็จก่อนรอบเกรดปิด (score-period.ts) โดยไม่รอให้มีคนเปิดเว็บ:
    //   1) หักคะแนนลงเวลาของคนที่กะจบแล้ว (dockFinishedShifts)
    //   2) รอบหักคะแนนรายงาน + งานเลยกำหนดของทุกบริษัท — เดิมรันเฉพาะตอนมีแท็บเปิดอยู่ วันตัดรอบตรงวันหยุด
    //      ไม่มีใครเปิดเว็บ ⇒ "ไม่ส่งรายงาน" ของวันนั้นถูกบันทึกหลังรอบปิด แล้วไม่ถูกนับเลย
    // แต่ละส่วนล้มเองได้ ไม่ลากส่วนอื่นล้มตาม
    try {
      Object.assign(result, { attendanceShiftEnd: await dockFinishedShifts(new Date()) });
    } catch (error) {
      console.error("[cron] attendance shift-end", error);
      Object.assign(result, { attendanceShiftEnd: { error: error instanceof Error ? error.message : String(error) } });
    }
    if (task === "score-final") {
      // 00:05 — วันเมื่อวานจบแล้ว: คืนคะแนนใบลา/แก้เวลาที่อนุมัติทัน (ไม่ต้องรอ 08:00 ซึ่งเลยเวลาพร้อมใช้ของวันตัดรอบ)
      try {
        Object.assign(result, { attendanceRefunded: await refundAttendanceDocks() });
      } catch (error) {
        console.error("[cron] attendance refund", error);
        Object.assign(result, { attendanceRefunded: { error: error instanceof Error ? error.message : String(error) } });
      }
    }
    Object.assign(result, { sweeps: await runScoreSweepsAllOrgs() });
  }
  if (task === "performance" || task === "all") {
    // สองแหล่ง: งานซ่อมบำรุงที่ปล่อยค้าง และผลลงเวลาจาก workforce
    Object.assign(result, {
      performance: {
        maintenance: await dockOverdueMaintenance(),
        attendance: await dockAttendance(),
      },
    });
  }

  // หลัง performance — ผลลงเวลาเพิ่งคำนวณใหม่ OT ของเมื่อวานเย็นจึงนับครบ
  if (task === "holidays" || task === "all") {
    // ล้มเองไม่ให้ลากงานอื่นล้มตาม — ดึงจาก Google ไม่ได้วันนี้ พรุ่งนี้ก็ลองใหม่
    try {
      Object.assign(result, { holidays: await syncPublicHolidays({ dryRun: url.searchParams.get("dryRun") === "1" }) });
    } catch (error) {
      console.error("[cron] holidays", error);
      Object.assign(result, { holidays: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  if (task === "ot-pending" || task === "all") {
    Object.assign(result, { otPending: await notifyPendingOvertime() });
  }

  return NextResponse.json(result);
}
