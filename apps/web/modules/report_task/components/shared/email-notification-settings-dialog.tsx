"use client";

import { Switch } from "@/modules/report_task/components/ui/switch";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { useEmailNotificationSettingsStore } from "@/modules/report_task/store/email-notification-settings-store";
import { Mail } from "lucide-react";

const categories: { key: "dueSoon" | "overdue" | "penalty" | "meetingInvite" | "assigned"; label: string; hint: string }[] = [
  { key: "assigned", label: "ได้รับมอบหมายงานใหม่", hint: "เมื่อมีคนมอบหมายงานให้คุณ" },
  { key: "dueSoon", label: "งานใกล้ถึงกำหนดส่ง", hint: "แจ้งล่วงหน้าก่อนกำหนดส่ง" },
  { key: "overdue", label: "งานเลยกำหนดส่ง", hint: "ทั้งของตัวเองและที่มอบหมายให้คนอื่น" },
  { key: "penalty", label: "ถูกหักคะแนน / ยกเลิกหักคะแนน", hint: "ทุกครั้งที่คะแนนของคุณเปลี่ยน" },
  { key: "meetingInvite", label: "ได้รับเชิญประชุม", hint: "เมื่อมีคนแท็กคุณในประชุมใหม่" },
];

/** Personal email notification preferences — lives on the settings page (src/app/settings/page.tsx), under โปรไฟล์ของฉัน. */
export function EmailNotificationSettingsPanel() {
  const settings = useEmailNotificationSettingsStore((s) => s.settings);
  const setEnabled = useEmailNotificationSettingsStore((s) => s.setEnabled);
  const setCategory = useEmailNotificationSettingsStore((s) => s.setCategory);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Mail className="h-4.5 w-4.5" /> การแจ้งเตือนทางอีเมล
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">เลือกว่าจะให้ส่งอีเมลแจ้งเตือนเรื่องอะไรบ้าง</p>
      </div>

      <Badge variant="outline" className="w-fit text-[10px] font-normal bg-[var(--bg-soft)] text-[var(--ink-soft)]">
        การตั้งค่านี้จะเริ่มทำงานเมื่อระบบเชื่อมต่อเซิร์ฟเวอร์อีเมลแล้ว — ตอนนี้บันทึกไว้ล่วงหน้าได้
      </Badge>

      <div className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">เปิดใช้งานแจ้งเตือนทางอีเมล</p>
          <p className="text-[11px] text-[var(--ink-soft)]">ปิดสวิตช์นี้เพื่อไม่รับอีเมลใดๆ เลย</p>
        </div>
        <Switch data-tour="settings-email-toggle" checked={settings.enabled} onCheckedChange={setEnabled} />
      </div>

      <div className={settings.enabled ? "space-y-1" : "space-y-1 opacity-50 pointer-events-none"}>
        {categories.map((c) => (
          <div key={c.key} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--bg-soft)]">
            <div>
              <p className="text-sm">{c.label}</p>
              <p className="text-[11px] text-[var(--ink-soft)]">{c.hint}</p>
            </div>
            <Switch checked={settings[c.key]} onCheckedChange={(v) => setCategory(c.key, v)} />
          </div>
        ))}
      </div>
    </div>
  );
}
