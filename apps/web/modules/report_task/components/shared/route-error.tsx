"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bug } from "lucide-react";
import { Button } from "@/modules/report_task/components/ui/button";
import { IssueReportDialog } from "@/modules/report_task/components/issue-report/issue-report-dialog";

/**
 * Shared body for every route segment's `error.tsx` — same UI as the root
 * boundary (`src/app/error.tsx`), just scoped to one segment so a crash in
 * e.g. one dashboard widget or report chart doesn't blank out the whole app,
 * only the page it happened on (sidebar/topbar stay up since they live above
 * this boundary in the layout tree).
 *
 * "แจ้งปัญหานี้" prefills the issue-report form with the error message, stack,
 * and the page it happened on — this is the highest-signal report source in
 * the app (spec §5.6 point 3): nobody has to retype what already flashed on
 * screen, and Agents get an actual stack trace instead of "it broke".
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">เกิดข้อผิดพลาดบางอย่าง</h1>
        <p className="text-sm text-muted-foreground">
          หน้านี้โหลดไม่สำเร็จ ลองรีเฟรชหรือกดปุ่มด้านล่างเพื่อลองใหม่
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={reset}>ลองใหม่</Button>
        <Button variant="outline" onClick={() => setReportOpen(true)}>
          <Bug className="h-4 w-4" /> แจ้งปัญหานี้
        </Button>
      </div>
      <IssueReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        initialTitle={`หน้าเสียที่ ${pathname}: ${error.message || "เกิดข้อผิดพลาด"}`.slice(0, 120)}
        initialDescription={`เกิดข้อผิดพลาดอัตโนมัติที่หน้า ${pathname}\n\n${error.message}\n\n${error.stack ?? ""}`.slice(0, 4000)}
      />
    </div>
  );
}
