import "server-only";
import OpenAI from "openai";

import type { ReceiptAi } from "./types";

/**
 * อ่านใบเสร็จจากรูป — ยอดเงิน วันที่ ร้าน เลขที่ใบเสร็จ + ข้อสังเกตที่ดูผิดปกติ
 * ใช้ key เดียวกับ AI Insight (OPENAI_API_KEY ของแพลตฟอร์ม) · ไม่มี key/อ่านไม่ได้ = null (กรอกเองตามปกติ)
 *
 * ผลนี้ "ช่วยกรอก + ช่วยเตือน" เท่านั้น — HR เป็นคนตัดสินจากรูปจริงเสมอ
 * (AI จับใบเสร็จปลอมที่ทำเนียน ๆ ไม่ได้ทุกใบ อย่าใช้แทนการดูด้วยตา)
 */

const MODEL = process.env.RECEIPT_AI_MODEL || "gpt-4o-mini";

const PROMPT = `คุณอ่านใบเสร็จ/ใบกำกับภาษี/สลิปทางด่วน/บิลน้ำมัน/สลิปโอนเงินจากแอปธนาคารของไทย ตอบเป็น JSON เท่านั้น:
{"isReceipt": boolean, "amount": number|null, "date": "YYYY-MM-DD"|null, "vendor": string|null, "receiptNo": string|null, "notes": string|null}
- amount = ยอดรวมที่ต้องจ่ายสุทธิ (รวม VAT แล้ว) เป็นบาท ตัวเลขล้วน
- date = วันที่บนใบเสร็จ แปลงปี พ.ศ. เป็น ค.ศ. (2569 → 2026) · อ่านไม่ออก = null
- notes = ภาษาไทยสั้น ๆ เฉพาะเมื่อเห็นสิ่งผิดปกติจริง เช่น ตัวเลขถูกขีดฆ่า/เขียนทับ ฟอนต์ไม่เข้ากัน ยอดรวมไม่ตรงกับรายการ ไม่มีชื่อร้าน · ปกติ = null
- สลิปโอนเงิน: amount = ยอดโอน · date = วันที่โอน · vendor = ชื่อผู้รับโอน · receiptNo = เลขที่รายการ/เลขอ้างอิง · isReceipt true
- ไม่ใช่ใบเสร็จหรือสลิป (เช่นรูปคน รูปของ) = isReceipt false`;

export async function readReceipt(buf: Buffer, mime: string): Promise<ReceiptAi | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !mime.startsWith("image/")) return null;
  try {
    const client = new OpenAI({ apiKey, timeout: 25_000, maxRetries: 1 });
    const res = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      max_tokens: 300,
      messages: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "อ่านใบเสร็จนี้" },
            { type: "image_url", image_url: { url: `data:${mime};base64,${buf.toString("base64")}`, detail: "high" } },
          ],
        },
      ],
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return null;
    const j = JSON.parse(raw) as Record<string, unknown>;
    const amount = typeof j.amount === "number" && Number.isFinite(j.amount) && j.amount > 0 ? Math.round(j.amount * 100) / 100 : null;
    const date = typeof j.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? fixYear(j.date) : null;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
    return { isReceipt: j.isReceipt !== false, amount, date, vendor: str(j.vendor), receiptNo: str(j.receiptNo), notes: str(j.notes) };
  } catch (error) {
    console.error("[requests] readReceipt failed", error);
    return null;
  }
}

/** โมเดลบางครั้งคืนปี พ.ศ. มา — แปลงกลับ */
function fixYear(d: string): string {
  const y = Number(d.slice(0, 4));
  return y >= 2400 ? `${y - 543}${d.slice(4)}` : d;
}
