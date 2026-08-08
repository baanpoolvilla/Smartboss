import { NextResponse, type NextRequest } from "next/server";
import {
  dockOverdueMaintenance,
  generateWorkOrdersForDuePms,
  notifyDuePmSchedules,
  notifyMissingExpenses,
} from "@/modules/maintenance/data/cron";
import { dockAttendance } from "@/lib/attendance-performance";

export const runtime = "nodejs";

/**
 * Cron ของโมดูลแจ้งซ่อมบำรุง (แทน DB trigger / RPC เดิมของ ChangYai)
 *   - สร้างใบงานจาก PM ที่ถึงกำหนด
 *   - แจ้งเตือน PM ใกล้ครบกำหนด (?task=pm-notify)
 *   - เตือนใบงานที่ยังไม่บันทึกค่าใช้จ่าย (?task=expense-reminder)
 *   - หักคะแนนงานที่ปล่อยค้าง + ผลลงเวลา (?task=performance) → หน้าสรุปรายคนของผู้บริหาร
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
  if (task === "performance" || task === "all") {
    // สองแหล่ง: งานซ่อมบำรุงที่ปล่อยค้าง และผลลงเวลาจาก workforce
    Object.assign(result, {
      performance: {
        maintenance: await dockOverdueMaintenance(),
        attendance: await dockAttendance(),
      },
    });
  }

  return NextResponse.json(result);
}
