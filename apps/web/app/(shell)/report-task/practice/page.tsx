"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePracticeStore } from "@/modules/report_task/store/practice-store";
import { usePracticeMissionStore, practiceMissions } from "@/modules/report_task/store/practice-mission-store";
import { PracticeBoard } from "@/modules/report_task/components/practice/practice-board";
import { PracticeTaskDialog } from "@/modules/report_task/components/practice/practice-task-dialog";
import { PracticeMissionsPanel } from "@/modules/report_task/components/practice/practice-missions-panel";
import { PracticeConfetti } from "@/modules/report_task/components/practice/practice-confetti";
import { PageHeader } from "@/modules/report_task/components/shared/page-header";
import { FlaskConical, PartyPopper, X } from "lucide-react";

export default function PracticePage() {
  const resetStore = usePracticeStore((s) => s.reset);
  const resetMissions = usePracticeMissionStore((s) => s.reset);
  const completed = usePracticeMissionStore((s) => s.completed);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  // Derived, not stored — "every mission done" is a pure function of
  // `completed`, no separate state to keep in sync with it.
  const showDone = completed.length === practiceMissions.length && completed.length > 0;

  // Nothing here should outlive one visit — start every entry into Practice
  // Mode from the same clean seeded state, and wipe it again on the way out
  // (both the effect cleanup below and the explicit exit button call reset).
  useEffect(() => {
    resetStore();
    resetMissions();
    return () => {
      resetStore();
      resetMissions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMissionId = useMemo(
    () => practiceMissions.find((m) => !completed.includes(m.id))?.id ?? null,
    [completed]
  );

  useEffect(() => {
    if (!showDone) return;
    const fireConfetti = () => setShowConfetti(true);
    fireConfetti();
    const t = setTimeout(() => setShowConfetti(false), 1300);
    return () => clearTimeout(t);
  }, [showDone]);

  function openCreateDialog() {
    setOpenTaskId(null);
    setDialogOpen(true);
  }
  function openTaskDialog(id: string) {
    setOpenTaskId(id);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-dashed border-[var(--brand-green)] bg-[var(--accent)] px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[var(--brand-green-dark)]">
            <FlaskConical className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--brand-green-dark)]">โหมดฝึกใช้งาน</p>
            <p className="text-xs text-[var(--brand-green-dark)]/80">
              ข้อมูลทั้งหมดในหน้านี้เป็นข้อมูลจำลอง แยกจากระบบจริงทั้งหมด — จะหายไปทันทีที่ออกจากโหมดนี้
            </p>
          </div>
        </div>
        <Link
          href="/"
          onClick={() => {
            resetStore();
            resetMissions();
          }}
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-green-dark)] bg-white rounded-full px-3 py-1.5 hover:bg-[var(--bg-soft)] transition-colors shrink-0"
        >
          <X className="h-3.5 w-3.5" /> ออกจากโหมดฝึกใช้งาน
        </Link>
      </div>

      <PageHeader
        title="ลองใช้งานบอร์ดงานจริง"
        subtitle="ทำภารกิจด้านล่างให้ครบ — ลองสร้าง ลาก และแก้ไขงานได้อย่างอิสระ ไม่กระทบข้อมูลจริงของบริษัท"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start">
        <PracticeBoard onOpenTask={openTaskDialog} onCreateTask={openCreateDialog} highlightTarget={activeMissionId} />
        <PracticeMissionsPanel completed={completed} activeMissionId={activeMissionId} />
      </div>

      <PracticeTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} taskId={openTaskId} />

      {showConfetti && <PracticeConfetti />}

      {showDone && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center space-y-3 shadow-2xl">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)]">
              <PartyPopper className="h-7 w-7" />
            </span>
            <h2 className="text-lg font-bold">ยินดีด้วย!</h2>
            <p className="text-sm text-[var(--ink-soft)]">คุณพร้อมใช้งาน EasyBoss Workspace แล้ว</p>
            <Link
              href="/"
              onClick={() => {
                resetStore();
                resetMissions();
              }}
              className="inline-flex items-center justify-center rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-sm font-semibold px-5 py-2.5 transition-colors"
            >
              ออกจากโหมดฝึกใช้งาน
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
