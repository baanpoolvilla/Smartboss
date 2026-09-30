import "server-only";
import nodemailer from "nodemailer";

/**
 * ส่งอีเมลผ่าน SMTP — อีเมลสรุปรายสัปดาห์ (spec §6.6) และแจ้งเตือนทีม dev (spec §3.3)
 *   SMTP_HOST / SMTP_PORT / SMTP_SECURE ("true" = TLS ตั้งแต่ต่อ มักใช้คู่กับพอร์ต 465)
 *   SMTP_USER / SMTP_PASS / SMTP_FROM
 */
export function mailConfigured(): boolean {
  return !!process.env.SMTP_HOST && !!process.env.SMTP_FROM;
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (!mailConfigured()) throw new Error("ยังไม่ได้ตั้งค่า SMTP_HOST / SMTP_FROM");
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  return transport;
}

export async function sendMail(msg: { to: string[]; subject: string; text?: string; html?: string }): Promise<void> {
  await getTransport().sendMail({ from: process.env.SMTP_FROM, ...msg, to: msg.to.join(", ") });
}
