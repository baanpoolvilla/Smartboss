"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@smartboss/ui/components/button";

import { decideScoreRequestAction } from "@/app/(shell)/hr/my-score/score-request-actions";

/**
 * คิวคำขอแก้คะแนน งาน/ใบงาน/PM เลยกำหนด (lib/score-requests.ts)
 * เจ้าของเรื่องเห็นเฉพาะใบที่ตัวเองอนุมัติ · CEO เห็นทุกใบ (อนุมัติแทนได้) — ใบที่ใกล้ตัดรอบขึ้นก่อน
 */

export interface ScoreQueueItem {
  id: string;
  userName: string;
  submitterName: string | null;
  label: string;
  title: string;
  points: number;
  dayText: string;
  reasonTag: string;
  reason: string;
  createdText: string;
  approverText: string;
  /** คนดูคือคนอนุมัติหลัก (เจ้าของเรื่อง) — ไม่ใช่ = CEO อนุมัติแทน */
  primary: boolean;
  /** ใบนี้แจ้งเตือน CEO ด้วยไหม (ไม่มีเจ้าของเรื่องที่อนุมัติได้) */
  notifiesCeo: boolean;
  deadlineText: string;
  urgent: boolean;
  open: boolean;
  href: string | null;
  status: "pending" | "approved" | "rejected" | "closed";
  statusText?: string;
}

export function ScoreRequestsQueue({ pending, decided, isCeo }: { pending: ScoreQueueItem[]; decided: ScoreQueueItem[]; isCeo: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-(--ink)">คำขอแก้คะแนน · งาน / ใบงาน / PM เลยกำหนด</h2>
        <p className="text-xs text-(--ink-soft)">
          {isCeo
            ? "เห็นทุกใบของบริษัท — ใบที่มีเจ้าของเรื่องอนุมัติได้ คุณอนุมัติแทนได้ แต่จะไม่มีแจ้งเตือนเด้ง"
            : "ใบที่คุณเป็นคนสั่งงาน / คนเปิดใบงาน / คนสร้างแผน PM"}
          {" · ต้องตัดสินภายใน 23:59 วันตัดรอบ หลังจากนั้นอนุมัติไปก็ไม่มีผลกับคะแนน"}
        </p>
      </div>
      {pending.length === 0 ? (
        <div className="rounded-2xl border border-(--line) bg-white p-6 text-center text-sm text-(--ink-soft)">ไม่มีคำขอรอพิจารณา</div>
      ) : (
        pending.map((item) => <ScoreRequestCard key={item.id} item={item} />)
      )}
      {decided.length > 0 && (
        <details className="rounded-2xl border border-(--line) bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-(--ink)">ตัดสินแล้วล่าสุด ({decided.length})</summary>
          <ul className="divide-y divide-(--line) border-t border-(--line)">
            {decided.map((item) => (
              <li key={item.id} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-(--ink)">
                    <b>{item.userName}</b> · {item.label} {item.dayText} · {item.title}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: item.status === "approved" ? "var(--tone-ok)" : item.status === "rejected" ? "var(--danger)" : "var(--ink-soft)" }}>
                    {item.statusText}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** การ์ดคำขอรอพิจารณา + ปุ่มอนุมัติ/ไม่อนุมัติ — ใช้ทั้งหน้าคิวและหน้าใบงาน */
export function ScoreRequestCard({ item }: { item: ScoreQueueItem }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "reject" | "approve">("idle");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function decide(decision: "approved" | "rejected") {
    setError(null);
    start(async () => {
      const r = await decideScoreRequestAction({ id: item.id, decision, note });
      // ไม่ผ่าน (มีคนตัดสินไปแล้ว / ปิดรอบ) ⇒ ค้างการ์ดไว้ให้อ่านข้อความก่อน — รีเฟรชทันทีการ์ดจะหายไปพร้อมข้อความ
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border bg-white p-4 ${item.urgent && item.open ? "border-amber-400 shadow-[0_0_0_3px_#fef3c7]" : "border-(--line)"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-(--ink)">
            <b>{item.userName}</b>
            {item.submitterName && <span className="text-(--ink-soft)"> · ยื่นโดย {item.submitterName}</span>}
            <span className="text-(--ink-soft)"> · ยื่น {item.createdText}</span>
          </div>
          <div className="mt-0.5 text-sm text-(--ink)">
            {item.label} {item.dayText} ·{" "}
            {item.href ? (
              <Link href={item.href} className="font-medium hover:underline">
                {item.title}
              </Link>
            ) : (
              item.title
            )}{" "}
            <span className="font-semibold tabular-nums" style={{ color: "var(--danger)" }}>
              {item.points}
            </span>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
            !item.open ? "bg-slate-100 text-slate-600 ring-slate-200" : item.urgent ? "bg-red-50 text-red-700 ring-red-200" : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {!item.open ? "ปิดรอบแล้ว · ไม่มีผลกับคะแนน" : item.urgent ? "ต้องตัดสินวันนี้" : item.deadlineText}
        </span>
      </div>
      <div className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">
        <span className="font-semibold">{item.reasonTag}</span> — {item.reason}
      </div>
      {!item.primary && (
        <p className="text-xs text-(--ink-soft)">
          คนอนุมัติหลัก: {item.approverText}
          {item.notifiesCeo ? " · ไม่มีคนอื่นอนุมัติได้ จึงแจ้ง CEO" : " · ใบนี้ไม่ได้แจ้งเตือน CEO — อนุมัติแทนได้ถ้าต้องการ"}
        </p>
      )}
      {mode !== "idle" && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={300}
          autoFocus
          placeholder={mode === "reject" ? "เหตุผลที่ไม่อนุมัติ (จำเป็น)" : "หมายเหตุ (ไม่บังคับ) เช่น ยืนยันว่าร้านส่งของช้าจริง"}
          className="rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm"
        />
      )}
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius) bg-red-50 px-3 py-2">
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
          <button type="button" onClick={() => router.refresh()} className="text-xs font-semibold text-(--brand-navy) underline">
            โหลดใหม่
          </button>
        </div>
      )}
      <div className="flex gap-2">
        {mode === "idle" ? (
          <>
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setMode("reject")}>
              ไม่อนุมัติ
            </Button>
            <Button className="flex-1" disabled={busy || !item.open} onClick={() => setMode("approve")}>
              {item.primary ? "อนุมัติ · คืนคะแนน" : "อนุมัติแทน · คืนคะแนน"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setMode("idle")}>
              ย้อนกลับ
            </Button>
            <Button
              className="flex-1"
              disabled={busy || (mode === "reject" && note.trim().length < 2)}
              onClick={() => decide(mode === "reject" ? "rejected" : "approved")}
            >
              {busy ? "กำลังบันทึก..." : mode === "reject" ? "ยืนยันไม่อนุมัติ" : `ยืนยันคืน +${Math.abs(item.points)} คะแนน`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
