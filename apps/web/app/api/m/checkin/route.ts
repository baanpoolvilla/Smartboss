import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@smartboss/auth";
import { wfFetch, WorkforceError, WorkforceUnavailableError } from "@/modules/hr/lib/api";
import { CHECKIN_PHOTO_ENABLED } from "@/modules/hr/lib/app-clock";

export const runtime = "nodejs";

const bodySchema = z.object({
  intent: z.enum(["AUTO", "CLOCK_IN", "CLOCK_OUT"]).default("AUTO"),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accuracyM: z.number().min(0).max(100_000).nullable(),
  /** JPEG/PNG เป็น base64 ล้วน (ไม่มีส่วนหัว data: URI) */
  photoBase64: z.string().min(32).max(12_000_000).optional(),
  photoContentType: z.enum(["image/jpeg", "image/png"]).optional(),
  deviceFingerprint: z.string().min(8).max(200).nullable().default(null),
});

interface SessionResponse {
  id: string;
  policy: {
    photo_required: string;
    location_required: boolean;
    capture_deadline_seconds: number;
    require_live_capture: boolean;
    max_accuracy_m: number;
  } | null;
}

interface CommitResult {
  decision: "ACCEPTED" | "ACCEPTED_WITH_WARNING" | "PENDING_REVIEW" | "REJECTED_POLICY";
  risk_flags: string[];
  matched_site_id: string | null;
  distance_from_site_m: number | null;
  captured_at: string;
}

interface SitesResponse {
  max_accuracy_m: number;
  sites: { id: string; name: string; latitude: number; longitude: number; radius_m: number }[];
}

/** ระยะทางระหว่างสองพิกัด (เมตร) — สูตรเดียวกับ distanceMeters ของตัวตัดสินฝั่งระบบบุคคล */
function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * ด่าน GPS — คืนข้อความบอกเหตุผล (ลงเวลาไม่ได้) หรือ null (ผ่าน)
 *
 * เจ้าของงานตัดสิน 2026-10-07: "ถ้าจีพีเอสตรงก็ลงได้เลย ถ้าไม่ตรงก็ลงไม่ได้" — ไม่มีคิวให้ HR ตรวจ
 * เดิมนอกเขต/GPS ไม่แม่นยังบันทึกไว้แล้วรอ HR ตรวจ (ไม่นับเวลาจนกว่าจะอนุมัติ) ซึ่งเสียเวลาทั้งสองฝ่าย
 *
 * ตัดสินก่อนเปิด session ⇒ ไม่ตรง = ไม่มีรายการเกิดขึ้นเลย · ใช้สถานที่/รัศมี/ความแม่นที่ยอมรับ
 * ชุดเดียวกับตัวตัดสินจริง (/me/checkin-sites ของระบบบุคคล) และเผื่อความคลาดเคลื่อนของ GPS แบบเดียวกัน
 * (ระยะ ≤ รัศมี + ความคลาดเคลื่อน) ⇒ ผ่านด่านนี้แล้ว ตัวตัดสินจะไม่ติดธงตำแหน่งซ้ำ
 */
async function gpsGate(
  latitude: number | null,
  longitude: number | null,
  accuracyM: number | null,
): Promise<string | null> {
  if (latitude === null || longitude === null) {
    return "ไม่ได้รับตำแหน่ง GPS — เปิด Location ในเครื่องและอนุญาตตำแหน่งให้แอป แล้วกดใหม่";
  }
  const { max_accuracy_m: maxAccuracy, sites } = await wfFetch<SitesResponse>("/me/checkin-sites");
  if (sites.length === 0) {
    return "ยังไม่ได้ตั้งสถานที่ทำงาน — แจ้ง HR ให้เพิ่มสถานที่ในระบบบุคคลก่อน";
  }
  const accuracy = accuracyM ?? 0;
  if (accuracy > maxAccuracy) {
    return `GPS ยังไม่แม่นพอ (คลาด ±${Math.round(accuracy)} ม. ต้องไม่เกิน ${maxAccuracy} ม.) — ออกไปที่โล่งหรือรอสักครู่ แล้วกดใหม่`;
  }
  let nearest: { name: string; distance: number; radius: number } | null = null;
  for (const site of sites) {
    const distance = distanceMeters({ latitude, longitude }, site);
    if (nearest === null || distance < nearest.distance) nearest = { name: site.name, distance, radius: site.radius_m };
  }
  if (nearest !== null && nearest.distance > nearest.radius + accuracy) {
    return `GPS ไม่ตรงสถานที่ทำงาน — อยู่ห่าง ${nearest.name} ${Math.round(nearest.distance)} ม. (ต้องอยู่ในรัศมี ${nearest.radius} ม.)`;
  }
  return null;
}

/**
 * ลงเวลาให้จบในคำขอเดียว
 *
 * ฝั่ง workforce แยกเป็น 3 จังหวะ (สร้าง session → แนบหลักฐาน → commit) เพื่อให้
 * แอปมือถือ retry ทีละขั้นได้เวลาสัญญาณหลุดกลางทาง · แต่ยิงสามรอบจากเบราว์เซอร์
 * ในอาคารที่สัญญาณไม่ดีคือสามโอกาสที่จะค้างคาครึ่งทาง ⇒ รวบไว้ที่เซิร์ฟเวอร์
 * ซึ่งคุยกับ workforce ผ่าน loopback แทน ฝั่งพนักงานยิงครั้งเดียวจบ
 *
 * นโยบายกลับมาพร้อม session ⇒ ถ้าบริษัทบังคับถ่ายรูปแต่ยังไม่ได้ส่งรูปมา
 * จะตอบ `PHOTO_REQUIRED` ให้หน้าจอเปิดกล้องแล้วยิงใหม่ทั้งก้อน
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const input = parsed.data;

  // ระบบบุคคลรับคำขอได้ไม่เกิน 1MB (workforce bootstrap bodyLimit) — หน้าจอย่อรูปให้ต่ำกว่า ~600KB แล้ว
  // (app/m/today.tsx compressPhoto) ด่านนี้กันเครื่องที่ย่อไม่ได้ ให้ได้ข้อความที่อ่านรู้เรื่องแทน 413 ดิบ
  if (input.photoBase64 !== undefined && input.photoBase64.length > 1_000_000) {
    return NextResponse.json(
      { error: "รูปใหญ่เกินไป — ลองถ่ายใหม่ หรือปิดโหมดความละเอียดสูงของกล้อง" },
      { status: 413 },
    );
  }

  // GPS ต้องตรงก่อนถึงจะบันทึก — ไม่ตรง = ไม่บันทึก บอกเหตุผลให้แก้แล้วกดใหม่ (ไม่มีคิวรอ HR ตรวจ)
  try {
    const gate = await gpsGate(input.latitude, input.longitude, input.accuracyM);
    if (gate !== null) {
      return NextResponse.json({ code: "GPS_REJECTED", error: gate }, { status: 422 });
    }
  } catch (error) {
    if (error instanceof WorkforceUnavailableError) {
      return NextResponse.json({ error: "ระบบบุคคลไม่พร้อมใช้งานชั่วคราว ลองใหม่อีกครั้ง" }, { status: 503 });
    }
    if (error instanceof WorkforceError) {
      return NextResponse.json({ error: error.displayMessage }, { status: error.status });
    }
    throw error;
  }

  // เวลาที่เครื่องผู้ใช้อ้าง — ฝั่ง workforce เทียบกับเวลาเซิร์ฟเวอร์เองอยู่แล้ว
  // และใช้เวลาเซิร์ฟเวอร์เป็นตัวตัดสิน ค่านี้เป็นแค่หลักฐานประกอบ
  const capturedAtClient = new Date().toISOString();

  try {
    const created = await wfFetch<SessionResponse>(
      "/time-events/photo-checkin-sessions",
      {
        method: "POST",
        body: {
          event_intent: input.intent,
          device_fingerprint: input.deviceFingerprint,
        },
      },
    );

    const policy = created.policy;
    // ปิดกล้องอยู่ (CHECKIN_PHOTO_ENABLED) = ไม่ขอรูปเลย ลงด้วย GPS อย่างเดียว
    const needsPhoto =
      CHECKIN_PHOTO_ENABLED &&
      policy !== null &&
      (policy.photo_required === "ALWAYS" || policy.photo_required === "RANDOM");

    if (needsPhoto && input.photoBase64 === undefined) {
      return NextResponse.json(
        {
          code: "PHOTO_REQUIRED",
          error: "บริษัทกำหนดให้ถ่ายรูปตอนลงเวลา",
          captureDeadlineSeconds: policy.capture_deadline_seconds,
        },
        { status: 400 },
      );
    }

    if (input.photoBase64 !== undefined) {
      await wfFetch(`/time-events/photo-checkin-sessions/${created.id}/evidence`, {
        method: "POST",
        body: {
          photo_base64: input.photoBase64,
          content_type: input.photoContentType ?? "image/jpeg",
          captured_at_client: capturedAtClient,
          live_capture: true,
        },
      });
    }

    const location =
      input.latitude === null || input.longitude === null
        ? null
        : {
            latitude: input.latitude,
            longitude: input.longitude,
            accuracy_m: input.accuracyM ?? 0,
          };

    const result = await wfFetch<CommitResult>(
      `/time-events/photo-checkin-sessions/${created.id}/commit`,
      {
        method: "POST",
        body: {
          captured_at_client: capturedAtClient,
          location,
          // เบราว์เซอร์ตรวจ mock location ไม่ได้เลย — ส่ง false ตามความจริง
          // อย่าเดาค่าให้ดูดี (ข้อจำกัดนี้อยู่ในสเปคข้อ 0.4)
          mock_location_suspected: false,
          app_version: "miniapp-1",
        },
      },
    );

    return NextResponse.json({
      decision: result.decision,
      riskFlags: result.risk_flags,
      distanceM: result.distance_from_site_m,
      capturedAt: result.captured_at,
    });
  } catch (error) {
    if (error instanceof WorkforceUnavailableError) {
      return NextResponse.json(
        { error: "ระบบบุคคลไม่พร้อมใช้งานชั่วคราว ลองใหม่อีกครั้ง" },
        { status: 503 },
      );
    }
    if (error instanceof WorkforceError) {
      return NextResponse.json(
        { error: error.displayMessage },
        { status: error.status },
      );
    }
    throw error;
  }
}
