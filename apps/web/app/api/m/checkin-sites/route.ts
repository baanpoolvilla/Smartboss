import { NextResponse } from "next/server";
import { getSession } from "@smartboss/auth";
import { wfFetch, WorkforceError, WorkforceUnavailableError } from "@/modules/hr/lib/api";

export const runtime = "nodejs";

interface SitesResponse {
  location_required: boolean;
  max_accuracy_m: number;
  sites: { id: string; name: string; latitude: number; longitude: number; radius_m: number }[];
}

/**
 * สถานที่ + รัศมีที่ตัวเองเช็คอินได้ — ให้หน้าแผนที่วาดวงก่อนกดเช็คอินจริง
 *
 * เรียก `/me/checkin-sites` ของ workforce ตรง ๆ (ไม่ใช่ `/sites` ของหลังบ้าน
 * ที่ต้องการ workforce.people.read ซึ่งพนักงานทั่วไปไม่มี) — endpoint นี้
 * กรองมาแล้วว่าเป็นของนโยบายที่มีผลกับตัวเองเท่านั้น
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  }

  try {
    const data = await wfFetch<SitesResponse>("/me/checkin-sites");
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof WorkforceUnavailableError) {
      return NextResponse.json(
        { error: "ระบบบุคคลไม่พร้อมใช้งานชั่วคราว ลองใหม่อีกครั้ง" },
        { status: 503 },
      );
    }
    if (error instanceof WorkforceError) {
      return NextResponse.json({ error: error.displayMessage }, { status: error.status });
    }
    throw error;
  }
}
