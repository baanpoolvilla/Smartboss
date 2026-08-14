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
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { todayIso } from "@/modules/report_task/lib/now";
import { X } from "lucide-react";

/**
 * Deliberately its own small dialog rather than another type bolted onto
 * NewTaskDialog — a to-do is just a title + a date, none of the
 * attendees/leave-type/attachment machinery that dialog carries for
 * meetings/leaves applies here.
 */
export function AddTodoDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
}) {
  const addTodo = useTodoStore((s) => s.addTodo);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate ?? todayIso());

  /**
   * ล้างฟอร์มตอนกล่องถูกเปิด — ปรับ state ระหว่าง render ไม่ใช่ใน effect
   *
   * แบบเดิมใช้ useEffect ซึ่ง React จะ render ด้วยค่าเก่าไปหนึ่งรอบก่อน
   * แล้วค่อย render ซ้ำด้วยค่าใหม่ (cascading render — eslint จับได้)
   * ท่านี้ React ทิ้ง render รอบนั้นทันทีแล้วเริ่มใหม่ด้วยค่าที่ถูก
   * ผู้ใช้จึงไม่เห็นวันที่เก่ากะพริบตอนเปิดกล่อง
   *
   * ล้าง title ด้วย — เดิมล้างเฉพาะตอนกดเพิ่มสำเร็จ ⇒ ปิดกล่องทิ้งกลางคัน
   * แล้วเปิดใหม่ ข้อความที่พิมพ์ค้างไว้ยังอยู่
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDate(defaultDate ?? todayIso());
      setTitle("");
    }
  }

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    addTodo({
      id: `todo-${crypto.randomUUID()}`,
      userId: viewingAsUserId,
      date,
      title: trimmed,
      done: false,
      createdAt: new Date().toISOString(),
    });
    setTitle("");
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
          <DialogTitle>เพิ่ม To Do</DialogTitle>
          <DialogDescription>รายการสั้น ๆ ที่ผูกกับวันที่ — ติ๊กเสร็จได้จากตัวปฏิทินเลย</DialogDescription>
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
          <DatePickerField value={date} onChange={setDate} />
        </div>

        <Button className="w-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white" disabled={!title.trim()} onClick={submit}>
          เพิ่ม To Do
        </Button>
      </DialogContent>
    </Dialog>
  );
}
