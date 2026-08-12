"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { useAttachmentSettingsStore, type AttachmentSettings } from "@/modules/report_task/store/attachment-settings-store";
import { Paperclip, Save } from "lucide-react";
import { toast } from "sonner";

const fields: { key: keyof AttachmentSettings; label: string; hint: string; unit: string }[] = [
  { key: "maxImageMB", label: "รูปภาพ", hint: "jpg, png, webp, gif", unit: "MB ต่อไฟล์" },
  { key: "maxFileMB", label: "เอกสาร", hint: "pdf, txt, zip", unit: "MB ต่อไฟล์" },
  { key: "maxVideoMB", label: "วิดีโอ", hint: "mp4, webm", unit: "MB ต่อไฟล์" },
  { key: "maxFilesPerTask", label: "ไฟล์แนบต่องาน", hint: "รวมทุกชนิดไฟล์ในงานเดียว", unit: "ไฟล์" },
  { key: "maxFilesPerComment", label: "ไฟล์แนบต่อความคิดเห็น", hint: "แนบพร้อมกันได้สูงสุดกี่ไฟล์ต่อ 1 ข้อความ", unit: "ไฟล์" },
];

/**
 * ขนาด/จำนวนไฟล์แนบสูงสุดของบริษัท — ปรับได้เอง ไม่ผูกกับแพ็กเกจสมัครสมาชิก
 * โดยอัตโนมัติในตอนนี้ (ดู attachment-settings-store.ts) เจ้าของบริษัทตั้งเอง
 * ให้ตรงกับแพ็กเกจที่จ่ายจริง — ฝั่งเซิร์ฟเวอร์ (/api/report-task/uploads)
 * บังคับตามค่านี้จริง ไม่ใช่แค่ UI hint
 */
export function AttachmentSettingsPanel() {
  const settings = useAttachmentSettingsStore((s) => s.settings);
  const setSettings = useAttachmentSettingsStore((s) => s.setSettings);
  const [draft, setDraft] = useState<AttachmentSettings>(settings);

  function update(key: keyof AttachmentSettings, value: number) {
    setDraft((d) => ({ ...d, [key]: Math.max(1, Math.round(value) || 1) }));
  }

  function save() {
    setSettings(draft);
    toast.success("บันทึกการตั้งค่าไฟล์แนบแล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-[var(--ink-soft)]" />
          ไฟล์แนบ
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          จำกัดขนาดไฟล์ต่อชนิด และจำนวนไฟล์แนบต่องาน/ต่อความคิดเห็น — ตั้งให้เหมาะกับแพ็กเกจที่บริษัทสมัครไว้
        </p>
      </div>

      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.key} className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-2.5">
            <div className="min-w-0 flex-1">
              <Label className="text-sm font-medium">{f.label}</Label>
              <p className="text-xs text-[var(--ink-soft)]">{f.hint}</p>
            </div>
            <Input
              type="number"
              min={1}
              value={draft[f.key]}
              onChange={(e) => update(f.key, Number(e.target.value))}
              className="w-20 text-center shrink-0"
            />
            <span className="text-xs text-[var(--ink-soft)] w-28 shrink-0">{f.unit}</span>
          </div>
        ))}
      </div>

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>
    </div>
  );
}
