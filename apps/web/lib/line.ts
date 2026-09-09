import "server-only";

/**
 * ตัวเชื่อมกับ LINE — OA กลางของ Smartboss ตัวเดียวสำหรับทุกบริษัท
 * (เหตุผลและข้อแลกเปลี่ยนอยู่ใน docs/line-mini-app-checkin-spec.md ข้อ 0.1)
 *
 * ── กฎที่ทั้งไฟล์นี้ยึด: env ที่ยังไม่ได้ตั้ง = ฟีเจอร์ปิดตัวเอง ไม่ใช่โปรเซสล้ม ──
 *
 * ห้าม throw ตอน import หรือตอนอ่านค่า เพราะ Next ที่ล้มตอนบูตคือทั้งเว็บดับ —
 * ระบบนี้มีคนใช้จริงอยู่แล้ว การ deploy โค้ดนี้ขึ้นไปโดยยังไม่ตั้ง env ต้องไม่
 * กระทบใครเลย แล้วค่อย "เปิด" ด้วยการเติม env ทีหลัง (สเปคข้อ 9.1)
 */

const VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";
const PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

/** ตั้งค่าครบพอให้ "ล็อกอินผ่าน LINE" ทำงานไหม */
export function lineLoginConfigured(): boolean {
  return (process.env.LINE_MINI_APP_CHANNEL_ID ?? "") !== "";
}

/** ตั้งค่าครบพอให้ "ส่งข้อความ" ทำงานไหม — คนละชุดกับข้างบน */
export function linePushConfigured(): boolean {
  return (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "") !== "";
}

export interface LineIdentity {
  /** LINE user ID — ค่านี้ผูกกับ *provider* ไม่ใช่ channel (สเปคข้อ 0.1) */
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
}

export type VerifyResult =
  | { ok: true; identity: LineIdentity }
  | { ok: false; reason: "not_configured" | "invalid_token" | "unreachable" };

/**
 * ตรวจ ID token ที่แอปส่งมา **กับเซิร์ฟเวอร์ของ LINE เท่านั้น**
 *
 * ⚠ ห้ามเปลี่ยนไปเชื่อ `liff.getProfile()` ที่ฝั่ง client ส่งมาเด็ดขาด
 * ค่านั้นเป็นแค่ JSON ที่ client พิมพ์เองได้ ⇒ ใครก็ส่ง userId ของคนอื่นมาแล้ว
 * ลงเวลาแทนกันได้ทั้งบริษัท · ID token เท่านั้นที่ LINE เซ็นรับรองให้
 *
 * `client_id` ต้องเป็น channel ID **ของสภาพแวดล้อมที่เสิร์ฟอยู่** (Developing /
 * Published คนละค่า) ใส่สลับกันจะได้ error "Invalid IdToken Audience"
 */
export async function verifyLineIdToken(idToken: string): Promise<VerifyResult> {
  const channelId = process.env.LINE_MINI_APP_CHANNEL_ID ?? "";
  if (channelId === "") return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (!response.ok) return { ok: false, reason: "invalid_token" };

  const payload = (await response.json()) as {
    sub?: unknown;
    aud?: unknown;
    name?: unknown;
    picture?: unknown;
  };

  // LINE ตรวจ aud ให้อยู่แล้ว แต่ตรวจซ้ำเองด้วย — ราคาถูกมาก และกันกรณีที่
  // วันหน้ามีคนเปลี่ยนไป verify ลายเซ็นเองแล้วลืมเช็ค audience
  if (typeof payload.sub !== "string" || payload.aud !== channelId) {
    return { ok: false, reason: "invalid_token" };
  }

  return {
    ok: true,
    identity: {
      userId: payload.sub,
      displayName: typeof payload.name === "string" ? payload.name : null,
      pictureUrl: typeof payload.picture === "string" ? payload.picture : null,
    },
  };
}

/**
 * ส่งข้อความหาพนักงานหนึ่งคนผ่าน OA กลาง
 *
 * ⚠ **ไม่ใช่ของฟรี** — LINE นับตามจำนวนผู้รับ และโควตาเป็นของ Smartboss ทั้งก้อน
 * ร่วมกันทุกบริษัท · โควตาหมดกลางเดือน = แจ้งเตือนของลูกค้าทุกรายดับพร้อมกัน
 * ⇒ ก่อนเพิ่มที่เรียกใหม่ ให้อ่านสเปคข้อ 0.1.1 ก่อนว่าเรื่องนั้นควร push จริงไหม
 * หรือให้ไปโผล่ที่กระดิ่งในแอปแทน (ฟรี)
 *
 * คืน false เมื่อส่งไม่สำเร็จ ไม่ throw — การแจ้งเตือนล้มต้องไม่ทำให้งานหลัก
 * (เช่น การอนุมัติใบเบิก) ล้มตามไปด้วย
 *
 * TODO ก่อนเปิดใช้จริง: ต่อตัวนับโควตารายบริษัทตามสเปคข้อ 0.1.1 ข้อ 3
 * และย้าย `sendLine()` ของ maintenance มารวมที่นี่ (สเปคข้อ 5) — ยังไม่ทำ
 * ตอนนี้โดยตั้งใจ เพราะทางเดิมกำลังส่งให้ลูกค้าจริงอยู่ (สเปคข้อ 9.2 ระดับ C)
 */
export async function pushLineText(
  lineUserId: string,
  text: string,
): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
  if (token === "") return false;

  try {
    const response = await fetch(PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
