import { notFound } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ceoTitle } from "@/lib/ceo-title";
import { FormLab } from "./form-lab";

/**
 * ⚠ ตัวอย่างทดลอง (prototype) — "ฟอร์มรายงานแบบบังคับ + AI ช่วยวิเคราะห์"
 * เปิดได้เฉพาะ localhost (production = 404) · ข้อมูลอยู่ในเบราว์เซอร์ของคนที่ลองเท่านั้น ไม่เขียนฐานข้อมูล
 * ไฟล์ชุดนี้อยู่ใน .git/info/exclude — ไม่ถูก commit จนกว่าจะตัดสินใจสร้างของจริง
 */
export const dynamic = "force-dynamic";

export default async function ReportFormLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const session = await requireOrg();
  const [me, boss] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } }),
    ceoTitle(),
  ]);
  return (
    <AppScaffold title="ฟอร์มรายงาน (ตัวอย่างทดลอง)" width="max-w-none" backHref="/">
      <FormLab userName={me?.name ?? "คุณ"} boss={boss} />
    </AppScaffold>
  );
}
