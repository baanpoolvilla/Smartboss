"use client";

import { useEffect, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "@/components/module/dialog";

/**
 * ชิป "ไม่ส่งรายงานประจำวัน -2 ×14" ที่กดได้ — แทนที่ span เดิมของหมวด
 * report_missed/report_late เท่านั้น (หมวดอื่นยังเป็นชิปธรรมดา ไม่ใช่ทุกหมวด
 * ที่รองรับการขอแก้ไข ณ ตอนนี้) เปิดไดอะล็อกให้เลือกว่า "ครั้งไหน" (หน้าคะแนน
 * โชว์แค่ยอดรวมต่อหมวด ไม่ได้แยกรายครั้ง — ต้องดึงจาก
 * /api/report-task/reports/penalty-events มาให้เลือกอีกที) แล้วยื่นคำร้อง
 *
 * อนุมัติ/ไม่อนุมัติทำที่หน้า /report-task/penalty-requests (CEO เท่านั้น) —
 * อนุมัติแล้วคืนคะแนนทันที ไม่ต้องส่งรายงานซ้ำ
 */
export function PenaltyRequestChip({
  userId,
  category,
  label,
  points,
  count,
}: {
  userId: string;
  category: "report_missed" | "report_late";
  label: string;
  points: number;
  count: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-(--line) px-2 py-0.5 text-[11px] text-(--ink-soft) hover:border-(--app) hover:text-(--ink) transition-colors"
        title="กดเพื่อขอแก้ไข/ขอส่งย้อนหลัง"
      >
        {label} <span style={{ color: "var(--danger)" }}>{points}</span>
        {count > 1 ? ` ×${count}` : ""}
      </button>
      {open && (
        <PenaltyRequestDialog
          userId={userId}
          category={category}
          categoryLabel={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface PenaltyEventItem {
  refId: string;
  points: number;
  day: string | null;
  topicName: string;
  roundLabel: string;
  hasPendingRequest: boolean;
}

function PenaltyRequestDialog({
  userId,
  category,
  categoryLabel,
  onClose,
}: {
  userId: string;
  category: "report_missed" | "report_late";
  categoryLabel: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PenaltyEventItem[]>([]);
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);
  const [type, setType] = useState<"retroactive" | "waive">("retroactive");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/report-task/reports/penalty-events?userId=${userId}&category=${category}`);
        const data = (await res.json()) as { items?: PenaltyEventItem[] };
        if (!cancelled) setItems(data.items ?? []);
      } catch {
        if (!cancelled) setError("โหลดรายการไม่สำเร็จ ลองปิดแล้วเปิดใหม่");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, category]);

  async function submit() {
    if (!selectedRefId || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/report-task/reports/penalty-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, refId: selectedRefId, type, reason }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "ยื่นคำร้องไม่สำเร็จ");
        return;
      }
      setDone(true);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Modal title="ยื่นคำร้องแล้ว" onClose={onClose} actions={<Button onClick={onClose}>ปิด</Button>}>
        <p className="text-sm text-(--ink)">
          ส่งคำร้องขอแก้ไขคะแนนให้ CEO พิจารณาแล้ว — คะแนนจะยังไม่เปลี่ยนจนกว่าจะได้รับการอนุมัติ
        </p>
      </Modal>
    );
  }

  const selectable = items.filter((i) => !i.hasPendingRequest);

  return (
    <Modal
      title={`ขอแก้ไข — ${categoryLabel}`}
      onClose={onClose}
      wide
      actions={
        <>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={submit} disabled={!selectedRefId || !reason.trim() || submitting}>
            {submitting ? "กำลังส่ง..." : "ส่งคำร้องให้ CEO อนุมัติ"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-(--ink-soft)">กำลังโหลด...</p>
        ) : selectable.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">
            ไม่มีรายการที่ยื่นคำร้องได้ — อาจถูกคืนคะแนนไปแล้ว หรือมีคำร้องรออยู่แล้วทุกรายการ
          </p>
        ) : (
          <div>
            <div className="mb-1.5 text-sm font-medium text-(--ink)">เลือกครั้งที่จะยื่นคำร้อง</div>
            <div className="flex flex-col gap-1.5">
              {selectable.map((item) => (
                <label
                  key={item.refId}
                  className="flex cursor-pointer items-center gap-2.5 rounded-(--radius) border border-(--line) px-3 py-2 text-sm hover:bg-(--bg-soft) has-checked:border-(--app)"
                >
                  <input
                    type="radio"
                    name="refId"
                    checked={selectedRefId === item.refId}
                    onChange={() => setSelectedRefId(item.refId)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {item.topicName} · {item.roundLabel} · {item.day ?? "-"}
                  </span>
                  <span className="shrink-0 font-mono" style={{ color: "var(--danger)" }}>
                    {item.points}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-sm font-medium text-(--ink)">ประเภทคำร้อง</div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-2.5 rounded-(--radius) border border-(--line) px-3 py-2 text-sm has-checked:border-(--app)">
              <input
                type="radio"
                name="type"
                className="mt-0.5"
                checked={type === "retroactive"}
                onChange={() => setType("retroactive")}
              />
              ขอส่งย้อนหลัง (มีเหตุสุดวิสัย เช่น ป่วยกะทันหัน ระบบขัดข้อง)
            </label>
            <label className="flex items-start gap-2.5 rounded-(--radius) border border-(--line) px-3 py-2 text-sm has-checked:border-(--app)">
              <input
                type="radio"
                name="type"
                className="mt-0.5"
                checked={type === "waive"}
                onChange={() => setType("waive")}
              />
              ขอให้พิจารณายกเลิกการหักคะแนน (คิดว่าไม่เป็นธรรม)
            </label>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">เหตุผล</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/30"
            placeholder="อธิบายเหตุผลให้ CEO พิจารณา"
          />
        </label>

        {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </Modal>
  );
}
