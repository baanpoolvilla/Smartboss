import { toast } from "sonner";
import { cn } from "@/modules/report_task/lib/utils";
import type { Sticker } from "@/modules/report_task/types";

/** A loud, color-coded toast for sticker reactions — the default sonner toast is too quiet for a penalty/praise action. */
export function showStickerToast(sticker: Sticker, taskTitle: string) {
  const negative = sticker.points < 0;
  const positive = sticker.points > 0;

  toast.custom(() => (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border-2 px-4 py-3 shadow-lg min-w-[300px] max-w-sm",
        negative && "bg-red-50 border-red-300",
        positive && "bg-green-50 border-[var(--brand-green)]",
        !negative && !positive && "bg-white border-[var(--line)]"
      )}
    >
      <span className="text-3xl leading-none shrink-0">{sticker.emoji}</span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-bold text-sm",
            negative && "text-red-700",
            positive && "text-[var(--brand-green-dark)]",
            !negative && !positive && "text-[var(--ink)]"
          )}
        >
          {sticker.label}
        </p>
        <p className="text-xs text-[var(--ink-soft)] truncate">งาน &quot;{taskTitle}&quot;</p>
      </div>
      {sticker.points !== 0 && (
        <span
          className={cn(
            "shrink-0 font-extrabold text-xl tabular-nums",
            negative ? "text-red-600" : "text-[var(--brand-green-dark)]"
          )}
        >
          {positive ? `+${sticker.points}` : sticker.points}
        </span>
      )}
    </div>
  ));
}
