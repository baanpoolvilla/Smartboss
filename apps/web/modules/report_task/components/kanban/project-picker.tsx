"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, FolderKanban, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/modules/report_task/components/ui/sheet";
import { filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { useIsMobile } from "@/modules/report_task/hooks/use-is-mobile";
import { cn } from "@/modules/report_task/lib/utils";

export interface ProjectOption {
  id: string;
  name: string;
  count: number;
}

/** เกินนี้ถึงมีช่องค้นหา — น้อยกว่านี้มองเห็นครบในกล่องอยู่แล้ว */
const SEARCH_FROM = 8;

/**
 * ปุ่มเลือกโปรเจคปุ่มเดียวบนหัวหน้าเจาะแผนก — หัวหน้าตาเดิมไม่ว่าจะมีกี่โปรเจค
 * ("ให้เลือกแผนกจากข้างนอกและให้เลือกโปรเจคข้างใน" · ชิปหลายอัน "มันจะไม่รกหรอ")
 *
 * คอม: กล่องลอยใต้ปุ่ม · มือถือ: แผ่นเลื่อนขึ้นจากด้านล่าง — รายการเดียวกัน สูงคงที่แล้ว
 * เลื่อนขึ้นลงข้างใน ช่องค้นหาติดอยู่บนสุด ("ขอเป็นสกอขึ้นลง ไม่ใช่เยอะยิ่งเพิ่ม")
 * เรียงงานมากไปน้อย, `unsortedId` (ไม่มีโปรเจค) แยกไว้ท้ายสุด
 * เลือกแล้ว = ปุ่มเป็นสีเขียวขึ้นชื่อโปรเจค + ✕ ล้างกลับเป็นทุกโปรเจค
 */
export function ProjectPicker({
  options,
  unsortedId,
  total,
  value,
  onChange,
}: {
  options: ProjectOption[];
  unsortedId: string;
  /** จำนวนงานของ "ทุกโปรเจค" */
  total: number;
  /** "all" หรือ id ของโปรเจค */
  value: string;
  onChange: (value: string) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const selected = value === "all" ? null : options.find((o) => o.id === value);
  const active = !!selected;

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  const label = (
    <>
      <FolderKanban className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[180px] truncate">{selected?.name ?? "ทุกโปรเจค"}</span>
      {!active && <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
    </>
  );
  const triggerClass = "flex min-w-0 items-center gap-1.5 outline-none";
  const list = <ProjectList options={options} unsortedId={unsortedId} total={total} value={value} onPick={pick} />;

  return (
    <div className={filterFieldTriggerClass(active, cn("min-w-0 shrink", active && "pr-1.5"))}>
      {isMobile ? (
        <>
          <button type="button" onClick={() => setOpen(true)} className={triggerClass} aria-label="เลือกโปรเจค">
            {label}
          </button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="bottom" className="gap-2 rounded-t-2xl pb-4">
              <SheetHeader className="pb-0 pr-11">
                <SheetTitle>เลือกโปรเจค</SheetTitle>
              </SheetHeader>
              <div className="px-3">{list}</div>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className={triggerClass} aria-label="เลือกโปรเจค">
            {label}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 gap-0 p-1.5">
            {list}
          </PopoverContent>
        </Popover>
      )}
      {active && (
        <button
          type="button"
          onClick={() => onChange("all")}
          className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-foreground)]/10 hover:bg-[var(--accent-foreground)]/20"
          aria-label="ดูทุกโปรเจค"
          title="ดูทุกโปรเจค"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function ProjectList({
  options,
  unsortedId,
  total,
  value,
  onPick,
}: {
  options: ProjectOption[];
  unsortedId: string;
  total: number;
  value: string;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const showSearch = options.length > SEARCH_FROM;

  const { named, unsorted } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (o: ProjectOption) => !q || o.name.toLowerCase().includes(q);
    return {
      named: options.filter((o) => o.id !== unsortedId && match(o)).sort((a, b) => b.count - a.count),
      unsorted: options.find((o) => o.id === unsortedId && match(o)),
    };
  }, [options, unsortedId, query]);

  const row = (id: string, name: string, count: number, muted = false) => (
    <button
      key={id}
      type="button"
      onClick={() => onPick(id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-soft)]",
        value === id && "bg-[var(--bg-soft)] font-semibold",
        muted && value !== id && "text-[var(--ink-soft)]"
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0 text-[var(--accent-foreground)]", value !== id && "invisible")} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-xs tabular-nums text-[var(--ink-soft)]">{count}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      {showSearch && (
        <label className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm focus-within:border-[var(--border-strong)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาโปรเจค…"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--ink-faint)]"
          />
        </label>
      )}
      {/* สูงคงที่ เลื่อนข้างใน — กล่องไม่ยืดตามจำนวนโปรเจค */}
      <div className="max-h-72 overflow-y-auto overscroll-contain">
        {!query.trim() && row("all", "ทุกโปรเจค", total)}
        {named.map((o) => row(o.id, o.name, o.count))}
        {unsorted && (
          <>
            {named.length > 0 && <div className="mx-2 my-1 border-t border-[var(--line)]" />}
            {row(unsorted.id, unsorted.name, unsorted.count, true)}
          </>
        )}
        {named.length === 0 && !unsorted && (
          <p className="px-2.5 py-3 text-center text-sm text-[var(--ink-soft)]">ไม่พบโปรเจคที่ชื่อมี “{query.trim()}”</p>
        )}
      </div>
    </div>
  );
}
