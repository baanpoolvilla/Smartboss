"use client";

import { useEffect } from "react";
import { Button } from "@/modules/report_task/components/ui/button";

/**
 * Shared body for every route segment's `error.tsx` — same UI as the root
 * boundary (`src/app/error.tsx`), just scoped to one segment so a crash in
 * e.g. one dashboard widget or report chart doesn't blank out the whole app,
 * only the page it happened on (sidebar/topbar stay up since they live above
 * this boundary in the layout tree).
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
      <Button onClick={reset}>ลองใหม่</Button>
    </div>
  );
}
