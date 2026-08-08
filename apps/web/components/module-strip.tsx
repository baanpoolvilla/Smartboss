import { cn } from "@smartboss/ui/cn";
import { MODULE_CARDS } from "@/lib/modules";

/** แถบสี 6 โมดูลเรียงกัน — brand element */
export function ModuleStrip({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {MODULE_CARDS.map((m) => (
        <span
          key={m.code}
          className="h-1.5 w-6 rounded-full"
          style={{ backgroundColor: `var(${m.colorVar})` }}
          aria-hidden
        />
      ))}
    </div>
  );
}
