"use client";

/**
 * หน้าใบงาน: แก้ผู้รับผิดชอบหลังสร้าง + เช็กลิสต์ (ผู้ใช้ 5/11/2569 "ทำออกมาให้ชัดเจนเข้าใจ")
 * กติกาอยู่ที่ lib/work-order-checklist.ts และ app/(shell)/maintenance/work-orders/team-actions.ts
 */
import { useState, useTransition } from "react";
import { Check, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";
import { AssigneeAndCc, type PickOption } from "./multi-picker";
import {
  addChecklistItemAction,
  removeChecklistItemAction,
  toggleChecklistItemAction,
  updateWorkOrderTeamAction,
} from "@/app/(shell)/maintenance/work-orders/team-actions";

export function WoTeamEditButton({
  id,
  users,
  assignedTo,
  members,
  rule,
  memberDue,
  lockMode,
}: {
  id: string;
  users: PickOption[];
  assignedTo: string;
  members: string[];
  rule: string;
  memberDue: Record<string, string>;
  lockMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        data-testid="team-edit"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-(--brand-navy) hover:bg-(--bg-soft)"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" /> แก้
      </button>
      {open && (
        <Modal title="แก้ผู้รับผิดชอบ" onClose={() => setOpen(false)}>
          <form
            className="flex flex-col gap-3"
            data-testid="team-form"
            action={(fd) =>
              start(async () => {
                const r = await updateWorkOrderTeamAction(fd);
                if (r.error) {
                  setError(r.error);
                  return;
                }
                toast.success("บันทึกผู้รับผิดชอบแล้ว");
                setOpen(false);
              })
            }
          >
            <input type="hidden" name="id" value={id} />
            <AssigneeAndCc
              users={users}
              defaultAssignee={assignedTo}
              defaultMembers={members}
              defaultRule={rule}
              defaultMemberDue={memberDue}
              lockMode={lockMode}
            />
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-(--ink-soft)">
              <li>คนที่เพิ่มได้แจ้งเตือน · ถ้าใบเลยกำหนดแล้วต้องตั้งวันส่งของคนใหม่</li>
              <li>คนที่เอาออก ถ้าโดนหักคะแนนไปแล้ว คะแนนยังอยู่ (ขอแก้ไขคะแนนได้ตามปกติ)</li>
            </ul>
            {error && (
              <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert" data-testid="team-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" size="sm" disabled={pending} data-testid="team-save">
                {pending ? "กำลังบันทึก…" : "บันทึก"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export interface ChecklistView {
  id: string;
  text: string;
  done: boolean;
  ownerName: string | null;
  doneByName: string | null;
  mine: boolean;
  canTick: boolean;
  canRemove: boolean;
}

export function WoChecklist({
  workOrderId,
  items,
  hint,
  canAdd,
  ownerOptions,
  defaultOwner,
  open,
}: {
  workOrderId: string;
  items: ChecklistView[];
  /** บรรทัดบอกกติกา/สิ่งที่ต้องทำต่อ */
  hint: string;
  canAdd: boolean;
  /** คนเปิดใบเลือกเจ้าของข้อได้ · ว่าง = ไม่ต้องเลือก (ใบเดี่ยว/ช่วยกันทำ/คนในทีมเพิ่มของตัวเอง) */
  ownerOptions: { id: string; label: string }[];
  defaultOwner: string | null;
  /** ใบยังเปิดอยู่ — ปิดแล้วดูอย่างเดียว */
  open: boolean;
}) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(defaultOwner ?? "");
  const [adding, setAdding] = useState(false);
  const done = items.filter((c) => c.done).length;
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
    });

  if (items.length === 0 && !(open && canAdd)) return null;
  return (
    <div className="rounded-(--radius) border border-(--line) p-3 text-sm sm:col-span-2" data-testid="wo-checklist">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-(--ink)">
          <ListChecks className="h-4 w-4 text-(--ink-soft)" aria-hidden="true" />
          เช็กลิสต์ {items.length > 0 && <span data-testid="checklist-progress">{done}/{items.length}</span>}
        </p>
        {open && canAdd && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            data-testid="checklist-add-open"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-(--brand-navy) hover:bg-(--bg-soft)"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> เพิ่มข้อ
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--bg-soft)">
          <div className="h-full rounded-full bg-(--app-strong) transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-xs text-(--ink-soft)" data-testid="checklist-hint">{hint}</p>
      <ul className="mt-2 flex flex-col">
        {items.map((c) => (
          <li key={c.id} className="flex min-w-0 items-start gap-2.5 border-b border-(--line) py-2 last:border-0" data-testid="checklist-item">
            <button
              type="button"
              role="checkbox"
              aria-checked={c.done}
              aria-label={c.text}
              disabled={!open || !c.canTick || pending}
              onClick={() => run(() => toggleChecklistItemAction(workOrderId, c.id))}
              data-testid="checklist-tick"
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors disabled:cursor-not-allowed ${
                c.done ? "border-(--app-strong) bg-(--app-strong) text-white" : c.canTick && open ? "border-(--ink-soft) bg-(--bg)" : "border-(--line) bg-(--bg-soft)"
              }`}
            >
              {c.done && <Check className="h-4 w-4" strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`break-words ${c.done ? "text-(--ink-soft) line-through" : "text-(--ink)"}`}>{c.text}</p>
              {(c.ownerName || c.doneByName) && (
                <p className="text-[11px] text-(--ink-soft)">
                  {c.ownerName && <span className={c.mine ? "font-semibold text-(--brand-navy)" : ""}>{c.mine ? "ของคุณ" : c.ownerName}</span>}
                  {c.ownerName && c.doneByName && " · "}
                  {c.doneByName && `ติ๊กโดย ${c.doneByName}`}
                </p>
              )}
            </div>
            {open && c.canRemove && (
              <button
                type="button"
                aria-label={`ลบ ${c.text}`}
                disabled={pending}
                onClick={() => {
                  if (confirm(`ลบ "${c.text}" ออกจากเช็กลิสต์?`)) run(() => removeChecklistItemAction(workOrderId, c.id));
                }}
                className="shrink-0 p-1 text-(--ink-soft) hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <form
          className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            run(async () => {
              const r = await addChecklistItemAction(workOrderId, text, owner || null);
              if (!r.error) setText("");
              return r;
            });
          }}
        >
          <input
            value={text}
            autoFocus
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder="พิมพ์ข้อใหม่"
            data-testid="checklist-add-text"
            className="h-9 min-w-0 flex-1 basis-40 rounded-lg border border-(--line) bg-(--bg) px-2.5 text-base text-(--ink) sm:text-sm"
          />
          {ownerOptions.length > 1 && (
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-label="เจ้าของข้อนี้"
              className="h-9 min-w-0 max-w-[45%] rounded-lg border border-(--line) bg-(--bg) px-1.5 text-xs text-(--ink)"
            >
              {ownerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" size="sm" disabled={pending || !text.trim()} data-testid="checklist-add-save">
            เพิ่ม
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            ปิด
          </Button>
        </form>
      )}
    </div>
  );
}
