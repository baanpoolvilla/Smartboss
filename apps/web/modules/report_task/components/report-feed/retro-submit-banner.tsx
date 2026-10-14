"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useRetroSubmitStore } from "@/modules/report_task/store/retro-submit-store";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";

const fmtDay = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });
const fmtDeadline = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * แถบ "CEO อนุมัติให้ส่งย้อนหลัง" เหนือช่องเขียนรีพอต — เห็นเฉพาะเจ้าของคำร้อง ในห้องของคำร้องนั้น
 * กด "ส่งย้อนหลัง" ⇒ ช่องเขียนรีพอตเปลี่ยนเป็นโหมดส่งย้อนหลัง (report-composer.tsx) · ส่งแล้วหรือเลยกำหนดแล้วหายไป
 */
export function RetroSubmitBanner({ topic }: { topic: ReportTopic }) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const posts = useReportFeedStore((s) => s.posts);
  const requests = useRetroSubmitStore((s) => s.requests);
  const target = useRetroSubmitStore((s) => s.target);
  const setTarget = useRetroSubmitStore((s) => s.setTarget);
  const load = useRetroSubmitStore((s) => s.load);
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    void load();
  }, [load, topic.id]);

  const open = requests.filter(
    (r) =>
      r.topicId === topic.id &&
      r.userId === viewingAsUserId &&
      new Date(r.retroDeadline).getTime() > openedAt &&
      !posts.some((p) => p.retroFor?.requestId === r.id)
  );
  if (open.length === 0) return null;
  const rounds = effectiveRoundsOf(topic);

  return (
    <div className="shrink-0 border-t border-violet-200 bg-violet-50 px-5 py-2.5 flex flex-col gap-2">
      {open.map((r) => {
        const round = rounds.find((x) => x.id === r.roundId);
        const lastMinute = new Date(new Date(r.retroDeadline).getTime() - 60_000);
        return (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-violet-900">
            <History className="h-4 w-4 shrink-0 text-violet-600" />
            <span className="min-w-0 flex-1">
              <b>CEO อนุมัติให้ส่งย้อนหลัง</b> · รีพอตวันที่ {fmtDay.format(new Date(`${r.day}T12:00:00+07:00`))}
              {round ? ` รอบ "${round.label}" (${round.time})` : ""} · ส่งได้ถึง {fmtDeadline.format(lastMinute)} น.
              <span className="text-violet-700/80"> · ส่งแล้วได้คะแนนคืน {Math.abs(r.points)} · ไม่ส่งยังโดนหัก</span>
            </span>
            <button
              type="button"
              disabled={target?.id === r.id}
              onClick={() => setTarget(r)}
              className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {target?.id === r.id ? "กำลังเขียน…" : "ส่งย้อนหลัง"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
