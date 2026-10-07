# ล็อกอินเว็บใช้รถบริษัท (carapprove) จาก SmartBoss

เป้าหมาย: กดไอคอน "ใช้รถบริษัท" ในหน้าแรกของ SmartBoss แล้วเว็บรถเปิดขึ้นข้างใน SmartBoss
**โดยล็อกอินเป็นคนนั้นให้เลย** ไม่ต้องกรอกรหัสซ้ำ เหมือน Multi Post / Baanpool-Chat

ฝั่ง SmartBoss ทำเสร็จแล้ว (`apps/web/lib/external-apps.ts`) — เหลือ 2 อย่าง:

1. ตั้ง secret ร่วมกันสองฝั่ง
2. เว็บรถเพิ่มหน้า `/sso` (ข้อ 2 ข้างล่าง)

ระหว่างที่ยังไม่เสร็จ ไอคอนยังใช้ได้ — เปิดหน้าเว็บรถธรรมดาให้ล็อกอินเอง

---

## 1. Secret ร่วม

สุ่มค่ายาว ๆ ค่าเดียว (เช่น `openssl rand -base64 48`) แล้วใส่ทั้งสองฝั่ง:

| ฝั่ง | ชื่อ env | ที่ตั้ง |
|---|---|---|
| SmartBoss | `SSO_CARAPPROVE_SECRET` | env file ของเซิร์ฟเวอร์ SmartBoss แล้ว restart |
| เว็บรถ | `SSO_SECRET` | Vercel → Project → Settings → Environment Variables แล้ว redeploy |

ห้ามใช้ค่าเดียวกับแอปอื่น (Multi Post / แชท) — secret ของใครของมัน

## 2. สิ่งที่ SmartBoss ส่งมา

เปิด `https://carapprove.vercel.app/sso?token=<JWT>&embed=1`

- `embed=1` มีเมื่อเปิดในกรอบข้างใน SmartBoss (กรณีปกติ) · ไม่มีเมื่อผู้ใช้กด "เปิดแท็บใหม่"
- `token` = JWT แบบ **HS256** เซ็นด้วย secret ข้อ 1 **อายุ 60 วินาที**

| claim | ค่า |
|---|---|
| `iss` | `smartboss` |
| `aud` | `carapprove` |
| `sub` | user id ใน SmartBoss |
| `name` | ชื่อที่แสดง |
| `email` | อีเมล — ใช้จับคู่กับผู้ใช้ของเว็บรถ |
| `isAdmin` | `true` ถ้าเป็น SUPER_ADMIN / ADMIN / CEO ใน SmartBoss |
| `jti` | id ไม่ซ้ำของ token นี้ |

## 3. หน้า `/sso` ของเว็บรถต้องทำ

1. ตรวจ token: ลายเซ็น HS256, `iss = smartboss`, `aud = carapprove`, ยังไม่หมดอายุ
   ไม่ผ่าน → พาไปหน้า `/login` ปกติ (ไม่ต้องบอกเหตุผล)
2. หาผู้ใช้ของเว็บรถจาก `email` — ไม่เจอ: สร้างใหม่ หรือพาไปหน้า login พร้อมข้อความ
   "บัญชีนี้ยังไม่มีในระบบใช้รถ" (เจ้าของเว็บรถเลือก)
3. สร้าง session ของเว็บรถตามปกติ แล้ว redirect ไป `/`
4. **ถ้ามี `embed=1`** cookie ของ session ต้องเป็น `SameSite=None; Secure; Partitioned`
   ไม่งั้นเบราว์เซอร์ไม่ส่ง cookie ในกรอบ → ล็อกอินแล้วหลุดทันที
   (ไม่มี `embed=1` ใช้ cookie แบบเดิมของเว็บได้)
5. (แนะนำ) จำ `jti` ที่ใช้แล้วไว้ 60 วินาที แล้วปฏิเสธซ้ำ — กันลิงก์หลุดถูกเปิดซ้ำ

เว็บรถต้อง **ไม่** ตั้ง `X-Frame-Options: DENY` หรือ CSP `frame-ancestors` ที่ไม่รวม
โดเมนของ SmartBoss (ตอนนี้ไม่ได้ตั้ง — เปิดในกรอบได้อยู่แล้ว)

## 4. ตัวอย่าง (Next.js App Router + `jose`)

```ts
// app/sso/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const embed = url.searchParams.get("embed") === "1";
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.SSO_SECRET!), {
      algorithms: ["HS256"],
      issuer: "smartboss",
      audience: "carapprove",
    });
    const email = String(payload.email ?? "");
    // TODO: หา/สร้างผู้ใช้จาก email แล้วออก session ตามระบบเดิมของเว็บรถ
    const sessionValue = await createSessionFor(email, String(payload.name ?? ""));

    const res = NextResponse.redirect(new URL("/", url));
    res.cookies.set("session", sessionValue, {
      httpOnly: true,
      secure: true,
      path: "/",
      sameSite: embed ? "none" : "lax",
      partitioned: embed, // Next 14.1+ · รุ่นเก่ากว่านี้ต่อ "; Partitioned" ใน Set-Cookie เอง
      maxAge: 60 * 60 * 12,
    });
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login", url));
  }
}
```

## 5. ทดสอบ

1. ตั้ง secret สองฝั่ง → restart SmartBoss + redeploy เว็บรถ
2. SmartBoss หน้าแรก → ไอคอน "ใช้รถบริษัท" → ต้องเข้าเว็บรถในกรอบเป็นชื่อตัวเองเลย
3. กดเมนูในเว็บรถไปมา 2–3 หน้า — ต้องไม่หลุดกลับหน้า login (ถ้าหลุด = ข้อ 3.4)
4. ปุ่ม "เปิดแท็บใหม่" บนแถบด้านบน → ต้องเข้าได้เหมือนกัน
