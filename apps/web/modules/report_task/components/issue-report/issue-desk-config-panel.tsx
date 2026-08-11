"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Button } from "@/modules/report_task/components/ui/button";
import { AttendeePicker } from "@/modules/report_task/components/shared/attendee-picker";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { isIssueAgent } from "@/modules/report_task/lib/permissions";
import { isKnownIssuesBannerActive, issueCategoryMeta } from "@/modules/report_task/lib/issue-meta";
import { ALL_ISSUE_CATEGORIES } from "@/modules/report_task/types/issue";
import { departments, users } from "@/modules/report_task/lib/directory";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Owner-facing config for the issue-report desk (recipient departments,
 * per-person Agent grants, enabled categories, known-issues banner). Lives
 * here (not inline in a page) so both /issue-reports and /settings can
 * render the exact same panel instead of drifting into two copies.
 */
export function IssueDeskConfigPanel({
  config,
  setConfig,
}: {
  config: ReturnType<typeof useIssueDeskConfigStore.getState>["config"];
  setConfig: (patch: Partial<ReturnType<typeof useIssueDeskConfigStore.getState>["config"]>) => void;
}) {
  const [bannerText, setBannerText] = useState(config.knownIssuesBanner?.text ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const currentAgents = users.filter((u) => isIssueAgent(config, u.id));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">แผนกที่รับเรื่อง (Agent)</p>
        <p className="text-xs text-[var(--ink-soft)] mt-0.5 mb-2">เฉพาะคนในแผนกที่เลือกไว้เท่านั้นที่เห็นทุกตั๋ว — คนอื่นเห็นแค่ตั๋วที่ตัวเองแจ้ง</p>
        <div className="flex flex-wrap gap-3">
          {departments.map((d) => {
            const checked = config.recipientDepartmentIds.includes(d.id);
            return (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) =>
                    setConfig({
                      recipientDepartmentIds: v === true
                        ? [...config.recipientDepartmentIds, d.id]
                        : config.recipientDepartmentIds.filter((id) => id !== d.id),
                    })
                  }
                />
                {d.name}
              </label>
            );
          })}
        </div>
        {/* Checkboxes alone don't say who that actually resolves to — this
         * is the "= 4 คน: สมชาย, นภัทร, ..." line an owner needs to sanity-check
         * a change before saving it. See ISSUE_DESK_AUDIT_2026-08-08.md §C4. */}
        <p className="text-xs text-[var(--ink-soft)] mt-2">
          {currentAgents.length === 0
            ? "ยังไม่มีใครเป็น Agent — ตั๋วที่แจ้งเข้ามาจะไม่มีใครเห็นเลยนอกจากเจ้าของระบบ"
            : `= ${currentAgents.length} คน: ${currentAgents.map((u) => u.name).join(", ")}`}
        </p>
      </div>

      <div>
        <p className="text-sm font-medium">Agent เพิ่มเติมรายบุคคล</p>
        <p className="text-xs text-[var(--ink-soft)] mt-0.5 mb-2">
          สำหรับคนที่ต้องเห็นตั๋วทั้งหมดแต่ไม่ได้อยู่แผนกที่เลือกไว้ด้านบน — ไม่ต้องเปิดทั้งแผนกเขาเพื่อคนเดียว
        </p>
        <AttendeePicker
          value={config.extraAgentUserIds}
          onChange={(ids) => setConfig({ extraAgentUserIds: ids })}
          placeholder="เลือกคนเพิ่มเติม..."
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">แบนเนอร์ &ldquo;ปัญหาที่รู้อยู่แล้ว&rdquo;</p>
          <Switch
            checked={isKnownIssuesBannerActive(config.knownIssuesBanner)}
            onCheckedChange={(v) =>
              setConfig({ knownIssuesBanner: { active: v, text: bannerText, updatedAt: new Date().toISOString() } })
            }
          />
        </div>
        <p className="text-xs text-[var(--ink-soft)] mt-0.5 mb-2">
          ขึ้นบนฟอร์มแจ้งปัญหาและหน้ารายการ กันคนแจ้งเรื่องเดียวกันซ้ำ — หมดอายุอัตโนมัติ 24 ชม.
          หลังบันทึก กันข้อความค้างข้ามสัปดาห์โดยไม่มีใครมาปิด
        </p>
        <div className="flex gap-2">
          <Textarea value={bannerText} onChange={(e) => setBannerText(e.target.value)} rows={2} placeholder="เช่น ระบบแจ้งเตือนอีเมลล่ม กำลังแก้ไข คาดว่าเสร็จ 15:00" />
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => setConfig({ knownIssuesBanner: { active: true, text: bannerText, updatedAt: new Date().toISOString() } })}
          >
            บันทึก
          </Button>
        </div>
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-[var(--ink-soft)] hover:text-[var(--ink)]"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-90")} />
          ตัวเลือกขั้นสูง
        </button>
        {advancedOpen && (
          <div className="mt-3">
            <p className="text-sm font-medium">หมวดหมู่ที่เปิดใช้ในฟอร์มแจ้งปัญหา</p>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5 mb-2">ส่วนใหญ่ไม่ต้องแตะ — เปิดครบทุกหมวดไว้ก็เพียงพอ</p>
            <div className="flex flex-wrap gap-3">
              {ALL_ISSUE_CATEGORIES.map((c) => {
                const checked = config.enabledCategories.includes(c);
                return (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setConfig({
                          enabledCategories: v === true
                            ? [...config.enabledCategories, c]
                            : config.enabledCategories.filter((x) => x !== c),
                        })
                      }
                    />
                    {issueCategoryMeta[c].label}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
