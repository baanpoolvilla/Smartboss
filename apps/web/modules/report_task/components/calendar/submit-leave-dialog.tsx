"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
import { Label } from "@/modules/report_task/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { X } from "lucide-react";
import { toast } from "sonner";
import { submitLeaveAction, type LeaveState } from "@/app/(shell)/hr/actions";

interface LeaveTypeChoice {
  id: string;
  label: string;
  autoApprove: boolean;
  monthlyQuotaDays: number;
}

interface LeaveContext {
  employmentId: string | null;
  myName: string;
  leaveTypes: LeaveTypeChoice[];
}

const EMPTY: LeaveState = {};

function firstWord(name: string): string {
  return name.trim().split(" ")[0] || name;
}

/** วันที่ทั้งหมดตั้งแต่ from ถึง to (รวมปลายทั้งสองข้าง) — ตรงกับที่
 * hr/leave/leave-calendar.tsx's DayDialog ใช้ ยื่นทีละใบต่อวัน ไม่รวบเป็นช่วง
 * เดียว เพราะ submitLeaveAction เองก็แยกยื่นทีละวันอยู่แล้ว (กันวันที่เลือกไม่
 * ติดกันแล้วกินวันกลางไปด้วย) */
function datesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > 62) break; // กันช่วงเพี้ยนจนยิงคำขอเป็นร้อยใบ
  }
  return out;
}

/**
 * ยื่นวันลาจริงผ่านระบบบุคคล (workforce) — เรียก submitLeaveAction ตัวเดียวกับ
 * หน้า /hr?tab=calendar เป๊ะ ๆ ไม่ใช่ระบบคู่ขนานที่เขียนลง store ในเครื่องเฉย ๆ
 * แบบที่ NewTaskDialog เคยทำ (ดู comment ที่ calendar-view.tsx's NewTaskDialog
 * — "a leave saved from this module never persisted") ประเภทการลา/ชื่อผู้ใช้
 * ดึงจาก /api/report-task/hr/leave-context (ห่อ wfFetch("/me")+"/leave-types"
 * ไว้ฝั่งเซิร์ฟเวอร์) ให้ตรงกับทะเบียนจริงของ HR เสมอ ไม่ใช่ leaveTypeStore ของ
 * โมดูลนี้เอง ยื่นสำเร็จแล้วรายการจะโผล่ในปฏิทินนี้เองรอบ poll ถัดไป เพราะ
 * leaves store อ่านจากตาราง workforce.leave_requests ตารางเดียวกันอยู่แล้ว
 * (ดู lib/db/workforce-calendar.ts)
 */
export function SubmitLeaveDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
}) {
  const [ctx, setCtx] = useState<LeaveContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(submitLeaveAction, EMPTY);

  const initialDate = defaultDate ?? new Date().toISOString().slice(0, 10);
  const [typeId, setTypeId] = useState("");
  // เปิดจากการ์ดสรุปวันที่คลิกไว้แล้ว (มี defaultDate) ก็ล็อกวันเริ่มไว้ตามนั้น
  // เปิดจากปุ่ม "+ ยื่นวันลา" เฉย ๆ (ไม่มี defaultDate จาก leave-sidebar.tsx) ก็
  // แก้วันเริ่มเองได้ — ไม่ผูกติดกับ "วันนี้" เสมอไป
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [labelTouched, setLabelTouched] = useState(false);
  const [label, setLabel] = useState("");

  // โหลดข้อมูลใหม่ทุกครั้งที่เปิด — ประเภทการลา/โควตาเปลี่ยนได้ที่ /hr/settings
  // เมื่อไหร่ก็ได้ ไม่ควรใช้ค่าที่ค้างจากครั้งก่อน
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCtx(null);
    setLoadError(null);
    fetch("/api/report-task/hr/leave-context")
      .then((r) => r.json())
      .then((data: LeaveContext & { error?: string }) => {
        if (cancelled) return;
        if (data.error) setLoadError(data.error);
        else setCtx(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("เชื่อมต่อระบบบุคคลไม่ได้");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // รีเซ็ตฟอร์มทุกครั้งที่เปิดใหม่/โหลดข้อมูลเสร็จ — คนละวันคนละรอบยื่นกัน
  useEffect(() => {
    if (!open || !ctx) return;
    setTypeId(ctx.leaveTypes[0]?.id ?? "");
    setStartDate(initialDate);
    setEndDate(initialDate);
    setLabelTouched(false);
    setLabel(`${firstWord(ctx.myName)}-${ctx.leaveTypes[0]?.label ?? "หยุด"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, open]);

  useEffect(() => {
    if (state.ok) {
      toast.success(`ยื่นวันลาแล้ว ${state.days} วัน`);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  const dates = useMemo(
    () => datesInclusive(startDate, endDate < startDate ? startDate : endDate),
    [startDate, endDate]
  );
  const leaveTypes = ctx?.leaveTypes ?? [];
  const canSubmit = !!ctx?.employmentId && leaveTypes.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
        >
          <X />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>ยื่นวันลา</DialogTitle>
          <DialogDescription>
            ยื่นผ่านระบบเดียวกับฝ่ายบุคคล (/hr) — ประเภทที่ต้องอนุมัติจะยังนับเป็นขาดงานจนกว่าจะได้รับอนุมัติ
          </DialogDescription>
        </DialogHeader>

        {loadError && <p className="text-sm text-(--danger)">{loadError}</p>}
        {!loadError && !ctx && <p className="text-sm text-(--ink-soft)">กำลังโหลด…</p>}

        {ctx && !ctx.employmentId && (
          <p className="text-sm text-(--ink-soft)">
            บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงาน — แจ้งฝ่ายบุคคลให้เพิ่มคุณเข้าทะเบียนก่อน
          </p>
        )}
        {ctx && ctx.employmentId && leaveTypes.length === 0 && (
          <p className="text-sm text-(--ink-soft)">
            ยังไม่มีประเภทการลาในระบบ — ฝ่ายบุคคลต้องสร้างก่อนอย่างน้อยหนึ่งประเภท
          </p>
        )}

        {canSubmit && ctx && (
          <form id="report-task-leave-form" action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="employment_id" value={ctx.employmentId ?? ""} />
            <input type="hidden" name="leave_type_id" value={typeId} />
            {dates.map((d) => (
              <input key={d} type="hidden" name="day" value={d} />
            ))}

            <div className="flex flex-col gap-1.5">
              <Label>ประเภทการลา *</Label>
              <Select
                value={typeId}
                onValueChange={(v) => {
                  if (!v) return;
                  setTypeId(v);
                  if (!labelTouched) {
                    const next = leaveTypes.find((t) => t.id === v);
                    setLabel(`${firstWord(ctx.myName)}-${next?.label ?? "หยุด"}`);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{leaveTypes.find((t) => t.id === typeId)?.label ?? "เลือกประเภท"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                      {t.autoApprove
                        ? ` — ไม่ต้องอนุมัติ${t.monthlyQuotaDays > 0 ? ` (${t.monthlyQuotaDays} วัน/เดือน)` : ""}`
                        : " — ต้องรออนุมัติ"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>ชื่อที่แสดงบนปฏิทิน</Label>
              <Input
                name="display_label"
                value={label}
                onChange={(e) => {
                  setLabelTouched(true);
                  setLabel(e.target.value);
                }}
                maxLength={60}
              />
              <p className="text-xs text-(--ink-soft)">
                ทั้งทีมเห็นชื่อนี้ — ใส่อะไรที่คนอ่านแล้วรู้เรื่อง เช่น "Bee-Off"
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>หยุดตั้งแต่วันที่</Label>
                <DatePickerField
                  value={startDate}
                  onChange={(v) => {
                    const next = v || initialDate;
                    setStartDate(next);
                    if (endDate < next) setEndDate(next);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>ถึงวันที่</Label>
                <DatePickerField value={endDate} onChange={(v) => setEndDate(v || startDate)} minDate={startDate} />
              </div>
            </div>
            <p className="-mt-2 text-xs text-(--ink-soft)">
              {dates.length === 1 ? "หยุดวันเดียว" : `หยุด ${dates.length} วัน (${startDate} ถึง ${endDate})`}
            </p>

            <div className="flex flex-col gap-1.5">
              <Label>เหตุผล</Label>
              <Input name="reason" maxLength={500} placeholder="ธุระส่วนตัว" />
              <p className="text-xs text-(--ink-soft)">เห็นเฉพาะผู้อนุมัติ ไม่ขึ้นบนปฏิทินรวม</p>
            </div>

            {state.error && <p className="text-sm text-(--danger)">{state.error}</p>}
          </form>
        )}

        <div className="mt-1 flex items-center justify-end gap-2 border-t border-(--line) pt-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
          {canSubmit && (
            <Button type="submit" form="report-task-leave-form" disabled={pending || !typeId}>
              {pending ? "กำลังบันทึก…" : dates.length === 1 ? "ยื่นวันลา" : `ยื่นวันลา ${dates.length} วัน`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
