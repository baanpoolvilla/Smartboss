"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { useShell } from "@/components/shell/shell-context";
import { Modal } from "./dialog";
import { IssueReportBarButton } from "@/modules/report_task/components/issue-report/issue-report-bar-button";
import { ReportNotificationSync } from "@/modules/report_task/components/shared/report-notification-sync";
import { NotificationBellPopover } from "@/modules/report_task/components/shared/notification-bell-popover";

/**
 * ปุ่มขวาสุดของ AppBar — NotificationBell + ปุ่มออกจากระบบ (พร้อมกล่องยืนยัน)
 * จำนวนแจ้งเตือนดึงจาก ShellProvider จึงไม่ query ซ้ำในทุกหน้า
 */
export function AppBarActions() {
  const { unread } = useShell();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <>
      <IssueReportBarButton />
      <ReportNotificationSync />

      <NotificationBellPopover extraUnread={unread} />

      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="ออกจากระบบ"
        aria-label="ออกจากระบบ"
        className="rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
      >
        <LogOut className="h-5 w-5" />
      </button>

      {confirming && (
        <Modal
          title="ยืนยันการออกจากระบบ"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={loading}
              >
                ยกเลิก
              </Button>
              <Button onClick={onLogout} disabled={loading} className="gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                ออกจากระบบ
              </Button>
            </>
          }
        >
          <p className="text-sm text-(--ink)">
            คุณต้องการออกจากระบบหรือไม่?
          </p>
        </Modal>
      )}
    </>
  );
}
