"use client";

import { useState } from "react";
import { CHECKIN_PROBLEMS, guessCheckinProblem, type CheckinProblem } from "@/modules/hr/lib/checkin-issue";

/**
 * "ลงเวลาไม่ได้? แจ้งไอที" ใต้ปุ่มลงเวลา (today.tsx) — กดแล้วกางให้เลือกปัญหา ส่งเป็นตั๋วแจ้งปัญหาถึงทีมไอที
 * (api/m/checkin-issue) ปิดไว้เป็นลิงก์เล็ก ๆ ไม่แย่งความสนใจจากปุ่มลงเวลา · เลือกปัญหาให้ก่อนจากข้อความ
 * error ล่าสุด คนแจ้งเปลี่ยนเองได้ · ข้อความ error/ความแม่นของ GPS/เครื่องแนบไปให้เอง
 */
export function CheckinIssueReport({ lastMessage, accuracyM }: { lastMessage: string | null; accuracyM: number | null }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<CheckinProblem>("other");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/m/checkin-issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problem,
          note,
          lastMessage,
          accuracyM,
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!response.ok || !payload.code) {
        setError(payload.error ?? "ส่งเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง");
        return;
      }
      setSent(payload.code);
      setOpen(false);
      setNote("");
    } catch {
      setError("ส่งเรื่องไม่สำเร็จ เช็กอินเทอร์เน็ตแล้วลองใหม่");
    } finally {
      setState("idle");
    }
  }

  if (sent && !open) {
    return (
      <div className="rounded-(--radius) bg-(--bg-soft) p-3 text-sm text-(--tone-ok)">
        ส่งเรื่องถึงไอทีแล้ว · เลขที่ {sent}
        <span className="block text-xs text-(--ink-soft)">ไอทีจะตอบกลับทางแจ้งเตือน ระหว่างนี้แจ้งหัวหน้าเวลาเข้างานจริงไว้ด้วย</span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setProblem(guessCheckinProblem(lastMessage));
          setOpen(true);
        }}
        className="self-center text-sm text-(--ink-soft) underline underline-offset-2"
      >
        ลงเวลาไม่ได้? แจ้งไอที
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-(--line) bg-(--bg-soft) p-4">
      <p className="text-sm font-semibold">แจ้งไอทีว่าลงเวลาไม่ได้</p>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="ปัญหาที่เจอ">
        {(Object.keys(CHECKIN_PROBLEMS) as CheckinProblem[]).map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="checkin-problem"
              value={key}
              checked={problem === key}
              onChange={() => setProblem(key)}
              className="h-4 w-4 accent-(--app)"
            />
            {CHECKIN_PROBLEMS[key]}
          </label>
        ))}
      </div>
      <textarea
        id="checkin-issue-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="รายละเอียดเพิ่ม (ไม่บังคับ) เช่น อยู่ตึกไหน ลองกี่ครั้งแล้ว"
        className="w-full rounded-xl border border-(--line) bg-(--bg) p-2.5 text-sm"
      />
      {lastMessage && <p className="text-xs text-(--ink-soft)">แนบข้อความที่ขึ้นล่าสุดไปให้ด้วย: “{lastMessage}”</p>}
      {error && <p className="text-xs text-(--danger)">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-(--line) px-4 py-2 text-sm">
          ยกเลิก
        </button>
        <button
          type="button"
          disabled={state === "sending"}
          onClick={() => void send()}
          className="rounded-xl bg-(--app) px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {state === "sending" ? "กำลังส่ง…" : "ส่งถึงไอที"}
        </button>
      </div>
    </div>
  );
}
