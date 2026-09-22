"use client";

import Link from "next/link";
import { useReportPenaltySettingsStore } from "@/modules/report_task/store/report-penalty-settings-store";
import { ShieldAlert } from "lucide-react";

/**
 * สวิตช์เปิด/ปิด "หักคะแนน HR เมื่อพลาด/ส่งช้ารายงาน" (เฟส 2 ของ
 * docs/spec-report-submission-rounds.md) — เมื่อเปิด `/api/report-task/reports/sweep`
 * (ทริกเกอร์จากทุกแท็บที่เปิดอยู่ เหมือน tasks/sweep) จะเริ่มบันทึกคะแนน
 * `report_missed`/`report_late` เข้าคะแนนผลงานรวม (core.performance_events)
 * ให้ทุกห้องที่ตั้งรอบส่งไว้ (Daily/Weekly/Monthly ใช้กลไกเดียวกัน)
 *
 * ตัวเลขที่หัก (กี่แต้ม) ยังตั้งที่หน้าคะแนนผลงานรวมเหมือนเดิม (ไม่ใช่ที่นี่)
 * — ที่นี่ควบคุมแค่ "เปิดให้หักจริงไหม" ของโมดูลรายงานเท่านั้น
 */
export function ReportPenaltySettingsPanel() {
  const enabled = useReportPenaltySettingsStore((s) => s.enabled);
  const setEnabled = useReportPenaltySettingsStore((s) => s.setEnabled);
  const graceDays = useReportPenaltySettingsStore((s) => s.weeklyMonthlyGraceDays);
  const setGraceDays = useReportPenaltySettingsStore((s) => s.setWeeklyMonthlyGraceDays);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
        <ShieldAlert className="h-4 w-4" />
        หักคะแนน HR เมื่อพลาด/ส่งช้ารายงาน
      </div>
      <p className="text-sm text-[var(--ink-soft)]">
        ค่าเริ่มต้นปิดไว้ — เปิดแล้วทุกห้องที่ตั้ง &quot;รอบส่งรายงาน&quot; ไว้ (Daily/Weekly/Monthly)
        จะเริ่มหักคะแนนผลงานอัตโนมัติเมื่อคนที่ต้องส่งพลาดกำหนดหรือส่งช้า
        เหมือนกับที่งาน (Task) เลยกำหนดหักคะแนนอยู่แล้ว
      </p>

      <label className="flex items-center gap-2.5 text-sm text-[var(--ink)]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        เปิดหักคะแนนเมื่อพลาด/ส่งช้ารายงาน
      </label>

      <p className="text-xs text-[var(--ink-soft)]">
        จำนวนแต้มที่หัก (&quot;ไม่ส่งรายงานประจำวัน&quot; / &quot;ส่งรายงานสาย&quot;) ตั้งที่{" "}
        <Link href="/admin/performance/settings" className="underline">
          หน้าคะแนนผลงานรวม
        </Link>{" "}
        — ปิดสวิตช์นี้ไว้ ค่าที่ตั้งไว้จะยังไม่มีผลอะไร ข้อมูลเดิมที่หักไปแล้วก่อนปิดยังอยู่เหมือนเดิม
      </p>

      <div className="pt-2 border-t border-[var(--line)]">
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          เผื่อเวลาส่งย้อนหลังของรอบรายสัปดาห์/รายเดือน
          <input
            type="number"
            min={0}
            max={30}
            value={graceDays}
            onChange={(e) => setGraceDays(Number(e.target.value))}
            className="w-16 rounded-md border border-[var(--line)] px-2 py-1 text-sm"
          />
          วัน
        </label>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          เลยกำหนดของรอบรายสัปดาห์/รายเดือนไปแล้ว (เช่นตั้งไว้ทุกวันศุกร์)
          แต่ยังส่งทันภายในจำนวนวันนี้ → หัก -1 (สาย) เท่านั้น เลยช่วงนี้ไปแล้วไม่ส่งเลย
          → หัก -2 (พลาด) ถาวร — ไม่มีผลกับรอบรายวัน (รอบรายวันมี &quot;เวลาปิดรับอัตโนมัติ&quot;
          ของตัวเองอยู่แล้วที่ตั้งค่าห้องแต่ละห้อง)
        </p>
      </div>
    </div>
  );
}
