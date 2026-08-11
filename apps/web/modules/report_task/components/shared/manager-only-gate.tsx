"use client";

import type { ReactNode } from "react";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage } from "@/modules/report_task/lib/directory";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { ShieldAlert } from "lucide-react";

/**
 * Blocks a whole page/section behind department-head-or-owner access —
 * company-wide performance data (everyone's completion rate/score) is the
 * same risk class as the dashboard's leaderboard/department chart, which
 * are already manager-only; this covers pages, not just single widgets.
 */
export function ManagerOnlyGate({ children }: { children: ReactNode }) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  if (!canManage(viewingAsUserId)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="หน้านี้สำหรับหัวหน้าแผนกและผู้บริหารเท่านั้น"
        description="แสดงข้อมูลผลงาน/คะแนนของทุกคนในองค์กร จำกัดสิทธิ์ให้เห็นเฉพาะระดับหัวหน้าขึ้นไป"
      />
    );
  }
  return <>{children}</>;
}
