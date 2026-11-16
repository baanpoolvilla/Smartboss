import { NextResponse, type NextRequest } from "next/server";
import OpenAI from "openai";
import { getSession, rateLimit } from "@smartboss/auth";

export const runtime = "nodejs";

/**
 * ⚠ ตัวอย่างทดลอง (prototype) ของ "ฟอร์มรายงาน + AI" — ใช้บน localhost เท่านั้น ไม่ขึ้นเครื่องจริง
 * (ตอบ 404 ใน production และไฟล์นี้อยู่ใน .git/info/exclude) มีไว้ให้ลองเล่นและวัดจำนวน token จริง
 * ก่อนตัดสินใจสร้างของจริง · ไม่เขียนฐานข้อมูล · ข้อความที่ส่งมาถูกส่งต่อให้ OpenAI ด้วยกุญแจของเครื่องนี้
 *
 * mode:
 *   split   — แยกข้อความรายงานลงหัวข้อของฟอร์ม + ใส่สีสถานะ (ตอบเป็น JSON)
 *   analyze — วิเคราะห์รายงานหนึ่งฉบับ: สรุป จุดเสี่ยง ควรทำอย่างไร
 *   chat    — ถามตอบต่อจากรายงานฉบับนั้น
 */
const MODEL = "gpt-4o-mini";

interface Topic { id: string; label: string; hint?: string }
interface Body {
  mode: "split" | "analyze" | "chat";
  topics?: Topic[];
  text?: string;
  report?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  question?: string;
}

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
  if (!(await rateLimit(`form-lab:${session.userId}`, 30, 60)).allowed) {
    return NextResponse.json({ error: "เรียก AI ถี่เกินไป รอสักครู่" }, { status: 429 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "เครื่องนี้ยังไม่ได้ตั้ง OPENAI_API_KEY" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });

  const openai = new OpenAI({ apiKey });
  let messages: { role: "system" | "user" | "assistant"; content: string }[];
  let json = false;
  let maxTokens = 500;

  if (body.mode === "split") {
    const topics = (body.topics ?? []).slice(0, 20);
    json = true;
    maxTokens = 700;
    messages = [
      {
        role: "system",
        content:
          "คุณช่วยจัดรายงานประจำวันของพนักงานลงแบบฟอร์ม ห้ามแต่งข้อมูลเพิ่ม ใช้เฉพาะข้อความที่พนักงานเขียน " +
          "ตอบเป็น JSON รูปแบบ {\"answers\":[{\"id\":\"...\",\"status\":\"green|yellow|red|none\",\"text\":\"...\"}]} ครบทุกหัวข้อตามลำดับ " +
          "status: red = มีปัญหาชัดเจน/ล่าช้าชัดเจน/งานเข้า, yellow = ก้ำกึ่ง/ล่าช้าเล็กน้อย/ต้องการให้ตัดสินใจ, green = เรียบร้อย/จัดการได้/ไม่มีปัญหา " +
          "ถ้าพนักงานใส่อีโมจิสี 🔴🟡🟢 หน้าหัวข้อ ให้ใช้สีนั้น ถ้าข้อความไม่ได้พูดถึงหัวข้อไหนเลย ให้ status เป็น none และ text ว่าง (อย่าเดาว่าไม่มี)",
      },
      {
        role: "user",
        content:
          "หัวข้อของฟอร์ม:\n" +
          topics.map((t) => `- id=${clip(t.id, 40)} : ${clip(t.label, 120)}${t.hint ? ` (${clip(t.hint, 200)})` : ""}`).join("\n") +
          "\n\nรายงานของพนักงาน:\n" +
          clip(body.text, 6000),
      },
    ];
  } else if (body.mode === "analyze") {
    maxTokens = 550;
    messages = [
      {
        role: "system",
        content:
          "คุณเป็นผู้ช่วยของผู้บริหารบริษัทบ้านพักตากอากาศ อ่านรายงานประจำวันของพนักงานหนึ่งคนแล้วตอบภาษาไทย กระชับ ตรงประเด็น ไม่เกิน 12 บรรทัด " +
          "จัดเป็น 4 หัวข้อ: 1) สรุปสั้น 2) จุดที่ต้องจับตาและเหตุผล 3) ควรทำอย่างไรต่อ (เป็นข้อ ทำได้จริง ระบุใครทำ) 4) คำถามที่ควรถามพนักงานกลับ " +
          "อ้างเฉพาะสิ่งที่อยู่ในรายงาน ถ้าข้อมูลไม่พอให้บอกว่าขาดอะไร อย่าเดาตัวเลข",
      },
      { role: "user", content: clip(body.report, 6000) },
    ];
  } else if (body.mode === "chat") {
    maxTokens = 450;
    messages = [
      {
        role: "system",
        content:
          "คุณเป็นผู้ช่วยของผู้บริหาร ตอบคำถามเกี่ยวกับรายงานประจำวันด้านล่าง ภาษาไทย กระชับ ไม่เกิน 8 บรรทัด ให้คำแนะนำที่ทำได้จริง " +
          "ถ้าคำถามต้องใช้ข้อมูลที่ไม่มีในรายงาน ให้บอกตรง ๆ ว่าไม่มี แล้วบอกว่าต้องถามใคร\n\nรายงาน:\n" +
          clip(body.report, 6000),
      },
      ...(body.history ?? []).slice(-8).map((m) => ({ role: m.role, content: clip(m.content, 2000) })),
      { role: "user", content: clip(body.question, 1000) },
    ];
  } else {
    return NextResponse.json({ error: "ไม่รู้จักคำสั่งนี้" }, { status: 400 });
  }

  try {
    const started = Date.now();
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" as const } } : {}),
    });
    const content = res.choices[0]?.message?.content ?? "";
    return NextResponse.json({
      content,
      model: MODEL,
      ms: Date.now() - started,
      usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
    });
  } catch (err) {
    return NextResponse.json({ error: `เรียก AI ไม่สำเร็จ: ${err instanceof Error ? err.message : "ไม่ทราบสาเหตุ"}` }, { status: 502 });
  }
}
