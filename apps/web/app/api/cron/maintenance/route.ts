import { NextResponse, type NextRequest } from "next/server";
import {
  dockOverdueMaintenance,
  generateWorkOrdersForDuePms,
  notifyDuePmSchedules,
  notifyMissingExpenses,
} from "@/modules/maintenance/data/cron";
import { dockAttendance } from "@/lib/attendance-performance";
import { purgeExpiredChatMedia } from "@/modules/chat/data/media-retention";
import { notifyLateArrivals } from "@/lib/attendance-late-alerts";
import { postAttendanceToChat } from "@/lib/attendance-chat";
import { notifyPendingOvertime } from "@/modules/hr/lib/hr-notify";
import { syncPublicHolidays } from "@/lib/public-holiday-sync";

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
 *   - หักคะแนนลงเวลาของวันนี้ตอน 23:59 ทุกคืน (?task=attendance-nightly — crontab แยกบรรทัด 59 23 * * *
 *     ไม่อยู่ใน all · รอบ 08:00 ของ all/performance ยังตรวจซ้ำวันก่อนหน้าเหมือนเดิม)
 *   - ?task=all รันทั้งหมด
 * เรียกด้วย header `Authorization: Bearer $CRON_SECRET` หรือ `?key=$CRON_SECRET`
 * route นี้อยู่นอก auth ของ proxy จึงกันด้วย CRON_SECRET เท่านั้น →
 * บน production ถ้าไม่ตั้ง secret ต้อง **ปิด** ไม่ใช่เปิดโล่ง (dev ยังเรียกได้เลย)
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
  if (task === "attendance-nightly") {
    // 23:59 ทุกคืน — หักคะแนนลงเวลาของวันนี้ทันที ไม่รอ 08:00 พรุ่งนี้ (ดู dockAttendance)
    // "วันนี้" จับไว้ตอนเริ่ม — งานคำนวณใหม่อาจเลยเที่ยงคืนไปแล้วตอนตัดสิน
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    Object.assign(result, { attendanceNightly: await dockAttendance({ today }) });
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
