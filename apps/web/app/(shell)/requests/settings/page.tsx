import { AppScaffold } from "@/components/module/app-scaffold";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { loadSettings } from "@/modules/requests/lib/data";
import { requestsPage } from "@/modules/requests/lib/page";
import { SettingsForm } from "@/modules/requests/components/settings-form";

export const dynamic = "force-dynamic";

/** เรื่องที่ผู้ใช้ขอเก็บไว้ทำทีหลัง (21/10/2569) — แสดงไว้ให้รู้ว่ายังไม่มี */
const LATER = [
  "เกณฑ์ตามยอดเงิน — ค่าใช้จ่าย/ค่าช่างภายนอกที่ยอดเกินที่ตั้งไว้ ต้องให้ CEO อนุมัติด้วย (HR ไปคุยตกลงยอดก่อน)",
  "ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) เป็น PDF จากใบช่างภายนอก",
  "เชื่อมกับระบบเงินเดือนอัตโนมัติ — ตอนนี้ใช้หน้า \"ส่งเข้าเงินเดือน\" ติ๊กทีละงวด",
];

export default async function RequestSettingsPage() {
  const { session } = await requestsPage(REQ_PERMS.settings);
  const settings = await loadSettings(session.orgId);
  return (
    <AppScaffold title="ตั้งค่าเบิกจ่าย & OT" backHref="/requests" width="max-w-3xl">
      <div className="flex flex-col gap-4">
        <SettingsForm initial={settings} />
        <section className="rounded-(--radius-lg) border border-dashed border-(--line) bg-(--bg) p-4">
          <h2 className="text-sm font-bold text-(--ink)">ยังไม่มี · จะทำต่อ</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-(--ink-soft)">
            {LATER.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </div>
    </AppScaffold>
  );
}
