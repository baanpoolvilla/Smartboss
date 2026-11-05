"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SmilePlus, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { StickerConfirmDialog } from "@/modules/report_task/components/shared/sticker-confirm-dialog";
import { getUser, isOwner } from "@/modules/report_task/lib/directory";
import { showStickerToast } from "@/modules/report_task/lib/sticker-toast";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useMaintenanceBoardStore } from "@/modules/report_task/store/maintenance-board-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { WO_TYPES, WO_TYPE_TAG_BG, woTypesOf, type MaintenanceBoardItem } from "@/modules/report_task/lib/maintenance-board";
import type { Sticker } from "@/modules/report_task/types";
import { WoCard } from "@/modules/maintenance/components/wo-card";

/** ความสำคัญบนบอร์ดงาน (critical/high/medium/low) → ชุดสีของใบงาน */
const WO_PRIORITY_BACK: Record<string, string> = { critical: "urgent" };

/** สีประจำประเภท — ใบงานซ่อม = เขียวอมฟ้า (สีโมดูลแจ้งซ่อม) */
export const MAINTENANCE_KIND = {
  wo: { icon: "🔧", label: "ใบงานซ่อม", color: "#0d9488", bg: "#e6f6f4" },
} as const;

/**
 * การ์ดใบงานซ่อมบนบอร์ดงาน — หน้าตาเดียวกับการ์ดงาน มีป้ายประเภท + แถบสีซ้าย บอกว่าไม่ใช่งานปกติ
 * กดการ์ดแล้วไปหน้านั้นในแจ้งซ่อม ?from=tasks = ปุ่มย้อนกลับพากลับบอร์ด (คอมเมนต์/สถานะ/ปิดงานทำที่นั่นที่เดียว)
 *
 * ทำบนบอร์ดได้อย่างเดียวคือ **ติดสติกเกอร์** (หัวหน้าเท่านั้น เหมือนการ์ดงาน) — คะแนนเข้าผู้รับผิดชอบใบงาน
 * ("แค่ให้มาแสดงและหักคะแนนใส่สติกเกอร์ได้ จะทำอะไรให้กดไปในแจ้งซ่อมเหมือนเดิม") ดู lib/db/work-order-reactions.ts
 */
export function MaintenanceCard({ item }: { item: MaintenanceBoardItem }) {
  const person = item.responsibleId ? getUser(item.responsibleId) : undefined;
  // คะแนนสติกเกอร์เข้าผู้รับผิดชอบจริงเท่านั้น (รูปบนการ์ดอาจเป็นคนเปิดใบ ถ้ายังไม่มอบหมาย)
  const assignee = item.assigneeId ? getUser(item.assigneeId) : undefined;
  const done = item.column === "done";
  const stickers = useStickerStore((s) => s.stickers);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const react = useMaintenanceBoardStore((s) => s.react);
  const unreact = useMaintenanceBoardStore((s) => s.unreact);
  const canSticker = isOwner(viewingAsUserId);
  const [pending, setPending] = useState<Sticker | null>(null);
  const [busy, setBusy] = useState(false);

  const reactions = item.reactions ?? [];
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.stickerId, (counts.get(r.stickerId) ?? 0) + 1);
  const mine = reactions.filter((r) => r.byUserId === viewingAsUserId);

  async function confirm() {
    if (!pending || busy) return;
    const sticker = pending;
    setPending(null);
    setBusy(true);
    const err = await react(item.id, sticker.id);
    setBusy(false);
    if (err) {
      toast.error(err);
      return;
    }
    showStickerToast(sticker, `${item.code} ${item.title}`, "ใบงาน");
    // แจ้งผู้รับผิดชอบที่โดนหัก/ได้คะแนน — แบบเดียวกับสติกเกอร์บนงาน (task-store addReaction)
    if (item.assigneeId && item.assigneeId !== viewingAsUserId) {
      const actorName = getUser(viewingAsUserId)?.name ?? "มีคน";
      const pts = sticker.points;
      useNotificationStore.getState().notify({
        userId: item.assigneeId,
        byUserId: viewingAsUserId,
        message: `${actorName} ติดสติกเกอร์ "${sticker.emoji} ${sticker.label}" ให้ใบงาน ${item.code} "${item.title}"${
          pts !== 0 ? ` (${pts > 0 ? `+${pts}` : pts} คะแนน)` : ""
        }`,
        link: item.href,
      });
    }
  }

  async function undo(reactionId: string) {
    setBusy(true);
    const err = await unreact(reactionId);
    setBusy(false);
    if (err) toast.error(err);
    else toast.success("ยกเลิกสติกเกอร์แล้ว คืนคะแนนให้แล้ว");
  }

  // การ์ดแบบการ์ดงาน ตัวเดียวกับบอร์ดแจ้งซ่อม (ผู้ใช้ 3/11/2569) — maintenance/components/wo-card.tsx
  // แถบหัวสีเขียว "ใบงานซ่อม" ยังอยู่ ให้รู้ว่าเป็นใบของแจ้งซ่อม · ทำอะไรต่อ กดไปทำในแจ้งซ่อมเหมือนเดิม
  const status = item.status ?? (done ? "completed" : item.column === "in_progress" ? "in_progress" : "open");
  return (
    <>
      <div className="relative">
      <WoCard
        id={item.id}
        href={`${item.href}?from=tasks`}
        code={item.code}
        title={item.title}
        place={item.place}
        tags={WO_TYPES.filter((t) => t.tag && woTypesOf(item).includes(t.id)).map((t) => ({ label: t.tag!, bg: WO_TYPE_TAG_BG[t.id] }))
          .concat(item.isPrivate ? [{ label: "ส่วนตัว", bg: "#1b2537" }] : [])}
        priority={WO_PRIORITY_BACK[item.priority] ?? item.priority}
        autoCreated={!!item.autoCreated}
        status={status}
        doneLabel={done ? item.statusLabel : undefined}
        dueDate={item.dueDate}
        expenseDeadline={item.expensePending ? item.dueDate : undefined}
        expenseRecorded={item.expenseRecordedTotal}
        commentCount={item.commentCount ?? 0}
        photoCount={item.photoCount ?? 0}
        pendingDue={item.pendingDue ?? 0}
        isPrivate={item.isPrivate}
        // ปุ่มสติกเกอร์วางทับนอกลิงก์ (ด้านล่าง) — เว้นที่ไว้ข้างรูปคน
        footerSlot={canSticker ? <span className="inline-block h-6 w-6" aria-hidden="true" /> : undefined}
        extraRow={
          counts.size > 0 ? (
            <div className="flex flex-wrap gap-1">
              {[...counts].map(([stickerId, count]) => {
                const sticker = stickers.find((s) => s.id === stickerId);
                if (!sticker) return null;
                return (
                  <span
                    key={stickerId}
                    title={`${sticker.label} (${sticker.points > 0 ? `+${sticker.points}` : sticker.points})`}
                    className="flex items-center gap-0.5 rounded-full bg-[var(--bg-soft)] px-1.5 py-0.5 text-[10px]"
                  >
                    <span>{sticker.emoji}</span>
                    {count > 1 && <span className="text-[var(--ink-soft)]">{count}</span>}
                  </span>
                );
              })}
            </div>
          ) : undefined
        }
        avatar={
          person ? (
            <span className="flex items-center gap-1">
            <Avatar className="h-6 w-6 shrink-0" title={person.name}>
              <AvatarImage src={person.avatarUrl ?? undefined} alt={person.name} />
              <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{person.avatar}</AvatarFallback>
            </Avatar>
            {person.id === item.assigneeId && (item.assigneeMore ?? 0) > 0 && <span className="text-[11px] font-semibold text-[var(--ink-soft)]" data-testid="card-more">+{item.assigneeMore}</span>}
            </span>
          ) : undefined
        }
      />
      {canSticker && (
        // นอก <Link> — เดิมวางในลิงก์ของการ์ด กดสติกเกอร์แล้วการกดทะลุไปเปิดหน้าใบงาน (กันด้วย preventDefault ไม่อยู่)
        // วางทับมุมขวาล่างของการ์ด ข้างรูปผู้รับผิดชอบ
        <div className="absolute bottom-3 right-[46px] sm:right-[54px]">
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  disabled={busy}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[var(--ink-soft)] ring-1 ring-inset ring-[var(--line)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--brand-green-dark)] hover:ring-[var(--brand-green)] disabled:opacity-50 data-[popup-open]:bg-[var(--accent)]"
                  title={assignee ? `ติดสติกเกอร์ / ให้คะแนน ${assignee.name}` : "ติดสติกเกอร์ / ให้คะแนน"}
                  aria-label="ติดสติกเกอร์ / ให้คะแนน"
                >
                  <SmilePlus className="h-3.5 w-3.5" />
                </button>
              }
            />
            <PopoverContent align="end" className="w-auto p-1.5">
              {!assignee ? (
                <p className="max-w-56 px-1.5 py-1 text-xs text-[var(--ink-soft)]">
                  ใบงานนี้ยังไม่มีผู้รับผิดชอบ — มอบหมายในแจ้งซ่อมก่อนถึงจะให้คะแนนได้
                </p>
              ) : (
                <>
                  <div className="flex gap-1">
                    {stickers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setPending(s)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition-colors hover:bg-[var(--bg-soft)]"
                        title={`${s.label} (${s.points > 0 ? `+${s.points}` : s.points})`}
                      >
                        {s.emoji}
                      </button>
                    ))}
                  </div>
                  {/* ยกเลิกของที่ตัวเองติดไว้ (กดผิด) — คืนคะแนนให้ */}
                  {mine.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5 border-t border-[var(--line)] pt-1.5">
                      <span className="px-1 text-[10.5px] text-[var(--ink-soft)]">ที่คุณติดไว้</span>
                      {mine.map((r) => {
                        const s = stickers.find((x) => x.id === r.stickerId);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            disabled={busy}
                            onClick={() => void undo(r.id)}
                            className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--bg-soft)] disabled:opacity-50"
                          >
                            <span>
                              {s?.emoji} {s?.label ?? r.stickerId}
                            </span>
                            <span className="inline-flex items-center gap-0.5 text-[var(--chart-red)]">
                              <X className="h-3 w-3" /> ยกเลิก
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}
      </div>
      {/* นอก <Link> — ปุ่มในหน้าต่างยืนยันต้องไม่ไปกดลิงก์การ์ดต่อ */}
      <StickerConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        sticker={pending}
        recipientName={assignee?.name ?? "ผู้รับผิดชอบ"}
        taskTitle={`${item.code} ${item.title}`}
        itemLabel="ใบงาน"
        onConfirm={() => void confirm()}
      />
    </>
  );
}
