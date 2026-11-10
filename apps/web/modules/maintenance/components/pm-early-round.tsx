"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FastForward } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

/**
 * ทำรอบล่วงหน้า (ผู้ใช้ 10/11/2569) — คนตั้ง PM เลือกรอบในอนาคตมาเปิดใบตอนนี้
 * ทำเสร็จ = รอบนั้นจบ ถึงวันของรอบระบบไม่เปิดซ้ำ · รอบที่มีใบแล้วไม่อยู่ในรายการ
 */
export function PmEarlyRound({
  pmId,
  title,
  options,
  windowDays,
  action,
}: {
  pmId: string;
  title: string;
  /** value = YYYY-MM-DD ของรอบ · label = วันของรอบ · dueLabel = ทำให้เสร็จภายใน */
  options: { value: string; label: string; dueLabel: string }[];
  windowDays: number;
  action: (formData: FormData) => Promise<{ error?: string; id?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(options[0]?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (options.length === 0) return null;

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("pmId", pmId);
    fd.set("round", round);
    start(async () => {
      // สำเร็จ = ฝั่งเซิร์ฟเวอร์พาไปหน้าใบงานเอง (redirect) · กลับมาที่นี่แปลว่ามีข้อผิดพลาด
      const r = await action(fd);
      if (r?.error) return setError(r.error);
      if (r?.id) router.push(`/maintenance/work-orders/${r.id}`);
    });
  };

  return (
    <>
      <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => setOpen(true)} data-testid="pm-early-round">
        <FastForward className="h-4 w-4" /> ทำรอบล่วงหน้า
      </Button>
      {open && (
        <Modal
          title="ทำรอบล่วงหน้า"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="button" size="sm" onClick={submit} disabled={!round || pending} data-testid="pm-early-round-submit">
                {pending ? "กำลังเปิดใบ…" : "เปิดใบงานรอบนี้"}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-(--ink)" data-testid="pm-early-round-dialog">
            <p className="font-medium">{title}</p>
            <p className="text-(--ink-soft)">
              เลือกรอบที่จะทำก่อน ระบบเปิดใบงานให้ตอนนี้เลย ทำเสร็จแล้วรอบนั้นจบ ถึงวันของรอบระบบไม่เปิดซ้ำ
            </p>
            <fieldset className="space-y-1.5">
              <legend className="sr-only">รอบที่จะทำก่อน</legend>
              {options.map((o, i) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 ${
                    round === o.value ? "border-(--brand-navy,#1b2537) bg-(--bg-soft)" : "border-(--line)"
                  }`}
                >
                  <input
                    type="radio"
                    name="early-round"
                    value={o.value}
                    checked={round === o.value}
                    onChange={() => setRound(o.value)}
                    className="accent-(--brand-navy,#1b2537)"
                  />
                  <span className="flex-1">
                    รอบ {o.label}
                    {i === 0 ? <span className="ml-1.5 text-xs text-(--ink-soft)">(รอบถัดไป)</span> : null}
                  </span>
                  <span className="text-xs text-(--ink-soft)">ทำให้เสร็จภายใน {o.dueLabel}</span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-(--ink-soft)">กำหนดส่งเหมือนรอบปกติ = วันของรอบ + {windowDays} วัน · ผู้รับผิดชอบของแผนได้แจ้งเตือนทันที</p>
            {error && <p className="text-xs text-(--tone-danger,#b91c1c)">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
