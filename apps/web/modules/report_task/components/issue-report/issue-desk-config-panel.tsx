"use client";

import { useState } from "react";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Button } from "@/modules/report_task/components/ui/button";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { isKnownIssuesBannerActive, issueCategoryMeta } from "@/modules/report_task/lib/issue-meta";
import { ALL_ISSUE_CATEGORIES } from "@/modules/report_task/types/issue";

/**
 * Owner-facing config for the "แจ้งปัญหาระบบ" intake form — which categories
 * show up, plus the pinned "known issues" banner. Lives here (not inline in
 * a page) so both /issue-reports and /settings render the same panel.
 *
 * Used to also configure "who receives tickets" (recipient departments,
 * per-person Agent grants) — that whole in-company desk concept is retired
 * now that every ticket goes straight to SmartBoss's own platform Super
 * Admin console (/admin/issue-reports) instead, so there's no more "who's
 * an agent" to assign here. `config.recipientDepartmentIds`/
 * `extraAgentUserIds` stay on `IssueDeskConfig` for now (no schema change
 * needed for a JSON blob), just unused by this panel and by
 * `isIssueAgent` (see lib/permissions.ts).
 */
export function IssueDeskConfigPanel({
  config,
  setConfig,
}: {
  config: ReturnType<typeof useIssueDeskConfigStore.getState>["config"];
  setConfig: (patch: Partial<ReturnType<typeof useIssueDeskConfigStore.getState>["config"]>) => void;
}) {
  const [bannerText, setBannerText] = useState(config.knownIssuesBanner?.text ?? "");

  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
