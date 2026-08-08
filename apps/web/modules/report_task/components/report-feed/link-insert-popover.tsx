"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Input } from "@/modules/report_task/components/ui/input";
import { Button } from "@/modules/report_task/components/ui/button";
import { Link2 } from "lucide-react";

/** Toolbar "แนบลิงก์" button — a small Popover+Input instead of `window.prompt()`
 * (C13), so it matches the rest of the design system instead of a jarring
 * native browser dialog. */
export function LinkInsertPopover({ onInsert, className }: { onInsert: (url: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onInsert(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    setValue("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            aria-label="แนบลิงก์"
            title="แนบลิงก์"
            className={className}
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="วางลิงก์ เช่น example.com"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="h-8 text-xs flex-1"
          />
          <Button size="sm" className="h-8 shrink-0" onClick={submit} disabled={!value.trim()}>
            แทรก
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
