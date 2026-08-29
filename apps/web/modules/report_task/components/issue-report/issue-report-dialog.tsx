"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Megaphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/modules/report_task/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Label } from "@/modules/report_task/components/ui/label";
import { AttachmentPicker } from "./attachment-picker";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useIssueReportStore } from "@/modules/report_task/store/issue-report-store";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { isKnownIssuesBannerActive, issueCategoryMeta, issueImpactMeta, issueSubmitLabel, NON_IMPACT_CATEGORIES } from "@/modules/report_task/lib/issue-meta";
import { ALL_ISSUE_CATEGORIES, type IssueAttachment, type IssueCategory, type IssueImpact } from "@/modules/report_task/types/issue";
import { getDepartment, getUser } from "@/modules/report_task/lib/directory";
import { cn } from "@/modules/report_task/lib/utils";

/** Categories that often touch something private (pay/perf-adjacent access
 * issues) — "ให้หัวหน้าแผนกเห็น" starts unticked for these specifically,
 * ticked for everything else. See ISSUE_DESK_AUDIT_2026-08-08.md §C3. */
function defaultShareWithHead(category: IssueCategory): boolean {
  return category !== "access";
}

const DESCRIPTION_TEMPLATE = `• ทำอะไรอยู่ตอนเจอ:
• คาดว่าควรเป็น:
• แต่ผลที่ได้คือ:
`;

/**
 * The one place a new ticket gets created — used by both the app-wide
 * floating button and the "แจ้งปัญหาใหม่" button on /issue-reports, so the
 * two entry points can never drift into different field sets.
 */
export function IssueReportDialog({
  open,
  onOpenChange,
  initialTitle,
  initialDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the form — used by the error boundary to hand over a crash's
   * message/stack so reporting it takes one click instead of retyping what
   * already flashed on screen (spec §5.6 point 3). */
  initialTitle?: string;
  initialDescription?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const addTicket = useIssueReportStore((s) => s.addTicket);
  const config = useIssueDeskConfigStore((s) => s.config);

  const enabledCategories = ALL_ISSUE_CATEGORIES.filter((c) => config.enabledCategories.includes(c));

  const [category, setCategory] = useState<IssueCategory>(enabledCategories[0] ?? "bug");
  const [impact, setImpact] = useState<IssueImpact>("workaround");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [description, setDescription] = useState(initialDescription ?? DESCRIPTION_TEMPLATE);
  const [attachments, setAttachments] = useState<IssueAttachment[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [shareWithHead, setShareWithHead] = useState(defaultShareWithHead(enabledCategories[0] ?? "bug"));
  const shareWithHeadTouched = useRef(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const isDirty =
    title.trim() !== "" ||
    description.trim() !== DESCRIPTION_TEMPLATE.trim() ||
    attachments.length > 0;

  const showImpact = !NON_IMPACT_CATEGORIES.includes(category);
  const reporterDept = getDepartment(getUser(viewingAsUserId)?.departmentId ?? "");
  const showShareWithHead = !!reporterDept?.headId && reporterDept.headId !== viewingAsUserId;

  function selectCategory(next: IssueCategory) {
    setCategory(next);
    if (!shareWithHeadTouched.current) setShareWithHead(defaultShareWithHead(next));
  }

  function reset() {
    const firstCategory = enabledCategories[0] ?? "bug";
    setCategory(firstCategory);
    setImpact("workaround");
    setTitle(initialTitle ?? "");
    setDescription(initialDescription ?? DESCRIPTION_TEMPLATE);
    setAttachments([]);
    setContextOpen(false);
    setShareWithHead(defaultShareWithHead(firstCategory));
    shareWithHeadTouched.current = false;
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error("กรุณากรอกหัวข้อ");
      return;
    }
    setSubmitting(true);
    try {
      const ticket = addTicket({
        reporterId: viewingAsUserId,
        category,
        title: title.trim(),
        description: description.trim() === DESCRIPTION_TEMPLATE.trim() ? "" : description.trim(),
        impact: showImpact ? impact : "minor",
        shareWithHead: showShareWithHead ? shareWithHead : false,
        attachments,
        context: {
          pageUrl: pathname,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
          occurredAt: new Date().toISOString(),
        },
      });
      reset();
      onOpenChange(false);
      router.push(`/report-task/issue-reports/${ticket.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  function requestClose(next: boolean) {
    if (!next && isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>แจ้งปัญหาการใช้งาน</DialogTitle>
          <DialogDescription>ส่งตรงถึงทีมดูแลระบบภายใน — ถ้าต้องส่งต่อผู้พัฒนาระบบ ทีมจะประสานงานให้เอง</DialogDescription>
        </DialogHeader>

        {isKnownIssuesBannerActive(config.knownIssuesBanner) && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-[var(--chart-amber)]">
            <Megaphone className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{config.knownIssuesBanner?.text}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-title">เกิดอะไรขึ้น?</Label>
            <Input
              id="issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="สรุปสั้นๆ ว่าเจออะไร เช่น 'ปุ่มบันทึกกดไม่ติดในหน้าโปรไฟล์'"
              maxLength={120}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ประเภท</Label>
            <div className="flex flex-wrap gap-1.5">
              {enabledCategories.map((key) => {
                const meta = issueCategoryMeta[key];
                const active = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectCategory(key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                        : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                    )}
                  >
                    <meta.icon className="h-3.5 w-3.5" /> {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {showImpact && (
            <div className="flex flex-col gap-1.5">
              <Label>ตอนนี้คุณ…</Label>
              <div className="flex flex-col gap-1.5">
                {(Object.keys(issueImpactMeta) as IssueImpact[]).map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="issue-impact"
                      checked={impact === key}
                      onChange={() => setImpact(key)}
                      className="h-3.5 w-3.5 accent-[var(--brand-green)]"
                    />
                    {issueImpactMeta[key].label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-description">รายละเอียด (แนะนำ)</Label>
            <Textarea
              id="issue-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
            />
          </div>

          <AttachmentPicker attachments={attachments} onChange={setAttachments} uploadedBy={viewingAsUserId} />

          {showShareWithHead && (
            <label className="flex items-start gap-2 text-xs text-[var(--ink-soft)] cursor-pointer">
              <input
                type="checkbox"
                checked={shareWithHead}
                onChange={(e) => {
                  shareWithHeadTouched.current = true;
                  setShareWithHead(e.target.checked);
                }}
                className="h-3.5 w-3.5 mt-0.5 accent-[var(--brand-green)]"
              />
              <span>
                ให้หัวหน้าแผนกเห็นเรื่องนี้ด้วย ({reporterDept?.name})
                <br />
                หัวหน้าเห็นแค่หัวข้อ+สถานะ ไม่เห็นข้อความในตั๋ว — ปลดออกได้ถ้าไม่อยากให้เห็น
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)] self-start"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", contextOpen && "rotate-90")} />
            ข้อมูลที่แนบให้อัตโนมัติ
          </button>
          {contextOpen && (
            <p className="text-xs text-[var(--ink-soft)] -mt-2">
              หน้า <code className="text-[var(--ink)]">{pathname}</code> ·{" "}
              {typeof window !== "undefined" ? `${window.innerWidth}×${window.innerHeight}` : ""}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => requestClose(false)}>ยกเลิก</Button>
          <Button
            disabled={submitting}
            className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
            onClick={handleSubmit}
          >
            {issueSubmitLabel(category)} → ทีมดูแลระบบ
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ทิ้งข้อมูลที่กรอกไว้?</AlertDialogTitle>
            <AlertDialogDescription>
              ยังไม่ได้ส่ง ถ้าปิดตอนนี้รายละเอียดปัญหาที่กรอกไว้จะหายไป
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>กรอกต่อ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={() => {
                setConfirmDiscardOpen(false);
                reset();
                onOpenChange(false);
              }}
            >
              ทิ้งข้อมูล
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
