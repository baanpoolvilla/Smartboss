"use client";

import { useEffect, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import {
  PenaltyRequestDialog,
  type PenaltyEventItem,
} from "@/app/(shell)/hr/employees/penalty-request-chip";

type Category = "report_missed" | "report_late";

const CATEGORY_LABEL: Record<Category, string> = {
  report_missed: "ไม่ส่งรายงานประจำวัน",
  report_late: "ส่งรายงานสาย",
};

interface Row extends PenaltyEventItem {
  category: Category;
}

/**
 * รายการ "วันที่ขาดส่ง/ส่งช้า" ของตัวเอง แบบเห็นชัดเจนตรง ๆ พร้อมปุ่ม
 * "ขอแก้ไข" ต่อแถว — เดิมมีแค่ชิปรวมที่ต้องกดถึงจะรู้ว่ากดได้ (ผู้ใช้จริงบอก
 * ว่าไม่รู้ว่าต้องกดตรงไหน) หน้า "คะแนนของฉัน" มีที่ว่างพอ เลยแสดงเป็นลิสต์
 * ตรง ๆ แทนดีกว่า — ดึงจาก /api/report-task/reports/penalty-events (ทั้ง 2
 * หมวด) แล้วรวมเรียงจากวันล่าสุด
 */
export function MissedReportsList({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRow, setOpenRow] = useState<Row | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [missed, late] = await Promise.all([
          fetch(`/api/report-task/reports/penalty-events?userId=${userId}&category=report_missed`).then((r) => r.json()),
          fetch(`/api/report-task/reports/penalty-events?userId=${userId}&category=report_late`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const missedRows: Row[] = ((missed.items ?? []) as PenaltyEventItem[]).map((i) => ({ ...i, category: "report_missed" as const }));
        const lateRows: Row[] = ((late.items ?? []) as PenaltyEventItem[]).map((i) => ({ ...i, category: "report_late" as const }));
        setRows([...missedRows, ...lateRows].sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) return <p className="text-sm text-(--ink-soft)">กำลังโหลด...</p>;
  if (rows.length === 0) return <p className="text-sm text-(--ink-soft)">ไม่มีรายการรายงานที่พลาด/ส่งช้าเลย</p>;

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div
          key={row.refId}
          className="flex items-center justify-between gap-3 rounded-(--radius) border border-(--line) px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-(--ink)">
              {CATEGORY_LABEL[row.category]} <span style={{ color: "var(--danger)" }}>{row.points}</span>
            </p>
            <p className="truncate text-xs text-(--ink-soft)">
              {row.topicName} · {row.roundLabel} · วันที่ {row.day ?? "-"}
            </p>
          </div>
          {row.hasPendingRequest ? (
            <span className="shrink-0 text-xs font-medium text-(--tone-warn)">รอ CEO พิจารณา</span>
          ) : (
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpenRow(row)}>
              ขอแก้ไข
            </Button>
          )}
        </div>
      ))}

      {openRow && (
        <PenaltyRequestDialog
          userId={userId}
          category={openRow.category}
          categoryLabel={CATEGORY_LABEL[openRow.category]}
          fixedItem={openRow}
          onClose={() => setOpenRow(null)}
        />
      )}
    </div>
  );
}
