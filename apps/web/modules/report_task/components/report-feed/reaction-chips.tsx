"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { REACTION_CHIP_CLASS } from "@/components/emoji-picker";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { getUser } from "@/modules/report_task/lib/directory";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * ป้ายรีแอคชันของข้อความตอบกลับ — หน้าตาและการกดแบบเดียวกับป้ายของโพสต์หลัก (report-card.tsx)
 * ตัวป้ายกดแล้วเห็นว่าใครกดบ้าง · "+" กดตามได้ทีเดียว (ขึ้นเฉพาะตอนเรายังไม่ได้กด) · เอาของตัวเองออกที่ "ยกเลิก" ในหน้าต่างรายชื่อ
 * เดิมข้อความตอบกลับเป็นปุ่มสลับเฉย ๆ ไม่มี "+" และดูไม่ได้ว่าใครรับทราบ (ผู้ใช้ 5/11/2569 "สติ๊กเกอร์แสดงไม่เหมือนกัน")
 */
export function ReactionChips({
  reactions,
  viewerId,
  onToggle,
  className,
}: {
  reactions: { emoji: string; users: string[] }[];
  viewerId?: string;
  onToggle: (emoji: string) => void;
  className?: string;
}) {
  const [listEmoji, setListEmoji] = useState<string | null>(null);
  if (reactions.length === 0) return null;
  const listUsers = reactions.find((r) => r.emoji === listEmoji)?.users ?? [];
  const viewerInList = listEmoji !== null && !!viewerId && listUsers.includes(viewerId);
  return (
    <>
      <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
        {reactions.map(({ emoji, users }) => {
          const active = !!viewerId && users.includes(viewerId);
          return (
            <div
              key={emoji}
              className={cn(
                REACTION_CHIP_CLASS,
                "items-stretch gap-0 overflow-hidden px-0",
                active ? "bg-[var(--accent)] text-[var(--brand-green-dark)] ring-1 ring-[var(--brand-green)]/40" : "bg-[var(--bg-soft)] text-[var(--ink-soft)] ring-1 ring-[var(--line)]"
              )}
            >
              <button
                type="button"
                onClick={() => setListEmoji(emoji)}
                aria-label={`ดูว่าใครกด ${emoji}`}
                className={cn("flex h-8 items-center gap-1 px-2", !active && "hover:bg-[var(--bg-soft)]")}
              >
                <span className="text-[20px] leading-none">{emoji}</span>
                {users.length > 1 && <span className="tabular-nums">{users.length}</span>}
              </button>
              {!active && viewerId && (
                <button
                  type="button"
                  onClick={() => onToggle(emoji)}
                  aria-label={`รีแอค ${emoji}`}
                  className="flex items-center px-1 border-l border-[var(--line)] hover:bg-[var(--accent)] hover:text-[var(--brand-green-dark)] transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={listEmoji !== null} onOpenChange={(open) => !open && setListEmoji(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-6">
              รีแอคชั่น
              {viewerInList && listEmoji !== null && (
                <button
                  type="button"
                  onClick={() => {
                    onToggle(listEmoji);
                    setListEmoji(null);
                  }}
                  className="text-xs font-medium text-[var(--chart-red)] hover:underline"
                >
                  ยกเลิก
                </button>
              )}
            </DialogTitle>
          </DialogHeader>
          {reactions.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {reactions.map(({ emoji, users }) => (
                <button
                  type="button"
                  key={emoji}
                  onClick={() => setListEmoji(emoji)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors",
                    emoji === listEmoji
                      ? "bg-[var(--accent)] border-[var(--brand-green)]/40 text-[var(--brand-green-dark)]"
                      : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  )}
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{users.length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1 max-h-72 overflow-y-auto" data-testid="reaction-who">
            {listUsers.map((userId) => {
              const u = getUser(userId);
              return (
                <div key={userId} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={u?.avatarUrl ?? undefined} alt={u?.name} />
                    <AvatarFallback className="text-xs bg-[var(--accent)] text-[var(--brand-green-dark)]">{u?.avatar}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium truncate">{u?.name ?? userId}</span>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
