import { notFound } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ceoTitle } from "@/lib/ceo-title";
import { BriefLab } from "./brief-lab";

/**
 * ⚠ ตัวอย่างทดลอง (prototype) — "AI สรุปรายงานให้ Boss" (12/11/2569)
 * เปิดได้เฉพาะ localhost (production = 404) · ไม่อ่าน/เขียนฐานข้อมูล
 * ข้อมูล = รายงานจริง 31 ฉบับ (7–11 พ.ย.) + ผลสรุปจริงจาก gpt-6-sol ที่ทำไว้ล่วงหน้าใน data.json
 * ไม่ commit จนกว่าจะตัดสินใจสร้างของจริง
 */
export const dynamic = "force-dynamic";

export default async function ReportBriefLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireOrg();
  const boss = await ceoTitle();
  return (
    <AppScaffold title="สรุปรายงาน (ตัวอย่าง)" width="max-w-6xl" backHref="/">
      <BriefLab boss={boss} />
    </AppScaffold>
  );
}
