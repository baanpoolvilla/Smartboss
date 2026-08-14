"use client";

import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/modules/report_task/components/ui/dialog";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { todayIso } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import { X, Trash2 } from "lucide-react";
import type { TodoItem } from "@/modules/report_task/types";

/**
 * Deliberately its own small dialog rather than another type bolted onto
 * NewTaskDialog — a to-do is just a title + a date, none of the
 * attendees/leave-type/attachment machinery that dialog carries for
 * meetings/leaves applies here. Doubles as the edit dialog — passing
 * `editingTodo` switches title/button copy and adds a delete action;
 * omitting it is the plain "create new" flow.
 */
export function AddTodoDialog({
  open,
  onOpenChange,
  defaultDate,
  editingTodo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
  editingTodo?: TodoItem | null;
}) {
  const addTodo = useTodoStore((s) => s.addTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate ?? todayIso());
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");

  /**
   * ล้างฟอร์ม/เติมค่าที่แก้ไขตอนกล่องถูกเปิด — ปรับ state ระหว่าง render
   * ไม่ใช่ใน effect (แบบเดิมใช้ useEffect ทำให้ React render ด้วยค่าเก่าไปหนึ่ง
   * รอบก่อนแล้วค่อย render ซ้ำ — ท่านี้ React ทิ้ง render รอบนั้นทันทีแล้ว
   * เริ่มใหม่ด้วยค่าที่ถูก ผู้ใช้จึงไม่เห็นค่าเก่ากะพริบตอนเปิดกล่อง)
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle(editingTodo?.title ?? "");
      setDate(editingTodo?.date ?? defaultDate ?? todayIso());
      setTime(editingTodo?.time ?? "");
      setNote(editingTodo?.note ?? "");
    }
  }

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const trimmedNote = note.trim();
    if (editingTodo) {
      updateTodo(editingTodo.id, { title: trimmed, date, time: time || undefined, note: trimmedNote || undefined });
    } else {
      addTodo({
        id: `todo-${crypto.randomUUID()}`,
        userId: viewingAsUserId,
        date,
        title: trimmed,
        done: false,
        createdAt: new Date().toISOString(),
        time: time || undefined,
        note: trimmedNote || undefined,
      });
    }
    onOpenChange(false);
  }

  function handleDelete() {
    if (!editingTodo) return;
    removeTodo(editingTodo.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogClose render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}>
          <X />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>{editingTodo ? "แก้ไขสิ่งที่ต้องทำ" : "เพิ่มสิ่งที่ต้องทำ"}</DialogTitle>
          <DialogDescription>รายการสั้น ๆ ที่ผูกกับวันที่ — ติ๊กเสร็จหรือลากย้ายวันได้จากตัวปฏิทินเลย</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="ต้องทำอะไร…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <div className="flex gap-2">
            <DatePickerField value={date} onChange={setDate} className="flex-1" />
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-[110px] shrink-0"
              aria-label="เวลา (ไม่บังคับ)"
            />
          </div>
          <Textarea
            placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>

        <div className="flex gap-2">
          {editingTodo && (
            <Button
              variant="outline"
              className="text-[var(--chart-red)] border-[var(--chart-red)]/30 hover:bg-red-50"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" /> ลบ
            </Button>
          )}
          <Button
            className={cn("bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white", editingTodo ? "flex-1" : "w-full")}
            disabled={!title.trim()}
            onClick={submit}
          >
            {editingTodo ? "บันทึก" : "เพิ่มสิ่งที่ต้องทำ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
