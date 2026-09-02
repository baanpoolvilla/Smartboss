"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";
import { Paperclip, Save } from "lucide-react";
import { toast } from "sonner";

/**
 * เดิม "รูป/คลิปต่อโพสต์รายงาน" อยู่รวมกับค่าไฟล์แนบของ Kanban (ตั้งค่า → งาน →
 * ไฟล์แนบ) ทั้งที่เป็นคนละหน้ากัน ("แยกได้ไหมหน้างานก็ตั้งค่าของหน้า task-kanban
 * แต่ของ report ก็เอาไปตั้งที่รีพอต") — แยกมาไว้ที่แท็บ "ห้อง Report" เอง
 * ยังใช้ค่าเดียวกันจาก attachment-settings-store (maxImagesPerReportPost)
 * แค่ย้ายจุดที่แก้ไข ไม่ได้แยกค่าออกเป็นคนละตัว
 */
export function ReportAttachmentSettingsPanel() {
  const value = useAttachmentSettingsStore((s) => s.settings.maxImagesPerReportPost);
  const setSettings = useAttachmentSettingsStore((s) => s.setSettings);
  const [draft, setDraft] = useState(value);

  function save() {
    setSettings({ maxImagesPerReportPost: draft });
    toast.success("บันทึกการตั้งค่าไฟล์แนบห้อง Report แล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-[var(--ink-soft)]" />
          ไฟล์แนบ
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          จำนวนรูป/คลิปสูงสุดที่แนบพร้อมกันได้ในโพสต์และคอมเมนต์ของห้อง Report — ขนาดไฟล์สูงสุดต่อชนิด (MB) เป็นค่าเดียวกับ Kanban ตั้งที่ ตั้งค่า → งาน → ไฟล์แนบ
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-2.5">
        <div className="min-w-0 flex-1">
          <Label className="text-sm font-medium">รูป/คลิปต่อโพสต์</Label>
          <p className="text-xs text-[var(--ink-soft)]">แนบพร้อมกันได้สูงสุดกี่รูป/คลิปต่อ 1 โพสต์หรือคอมเมนต์</p>
        </div>
        <Input
          type="number"
          min={1}
          value={draft}
          onChange={(e) => setDraft(Math.max(1, Math.round(Number(e.target.value)) || 1))}
          className="w-20 text-center shrink-0"
        />
        <span className="text-xs text-[var(--ink-soft)] w-20 shrink-0">รูป/คลิป</span>
      </div>

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>
    </div>
  );
}
