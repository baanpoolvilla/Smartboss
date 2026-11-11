"use client";

import { createPortal } from "react-dom";
import { WoRuleInfo } from "./wo-rule-info";
import { useRef, useState, useEffect } from "react";
import { Check, ChevronDown, ChevronRight, ListChecks, Plus, Search, UserPlus, X } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { todayBangkok } from "@/modules/maintenance/lib/no-past-date";

/** รายการเกินเท่านี้ถึงมีช่องค้นหา */
const SEARCH_FROM = 8;

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
}

/**
 * เลือกหลายรายการผ่าน dialog + แสดงเป็น Chip ลบได้
 * ตรงกับ _showPropertyPicker / _showCcPicker ของ ChangYai
 */
export function MultiPicker({
  name,
  title,
  heading,
  hint,
  emptyText,
  addLabel,
  options,
  defaultSelected = [],
  exclude = [],
  chipBg = "#EFF6FF",
  icon = "home",
  onChange,
  boxed = false,
}: {
  name: string;
  title: string;
  heading: string;
  hint?: string;
  emptyText: string;
  addLabel: string;
  options: PickOption[];
  defaultSelected?: string[];
  exclude?: string[];
  chipBg?: string;
  icon?: "home" | "user";
  onChange?: (ids: string[]) => void;
  /** ทั้งช่องกดเลือกได้ ไม่มีปุ่มแยก แบบช่องผู้รับผิดชอบของหน้าสร้างงาน (ผู้ใช้ 5/11/2569) — ไม่ส่ง = แบบเดิม */
  boxed?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(defaultSelected);

  const set = (ids: string[]) => {
    setSelected(ids);
    onChange?.(ids);
  };

  const labelOf = (id: string) =>
    options.find((o) => o.id === id)?.label ?? id;

  // รายชื่อยาวต้องค้นได้ ไม่งั้นเลื่อนหาลำบาก (ผู้ใช้ 5/11/2569 "คนเป็นร้อย เลื่อนหากันตายเลย")
  const [query, setQuery] = useState("");
  const showSearch = boxed && options.filter((o) => !exclude.includes(o.id)).length > SEARCH_FROM;
  const q = query.trim().toLowerCase();

  const openPicker = () => {
    setDraft(selected);
    setQuery("");
    setOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {boxed ? (
        <>
          <span className="text-xs text-(--ink-soft)">{heading}</span>
          {/* div ไม่ใช่ button — ข้างในมีปุ่มลบของแต่ละชิป ซ้อน button ไม่ได้ */}
          <div
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              openPicker();
            }}
            title={selected.map(labelOf).join(", ") || undefined}
            className="flex h-10 w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm hover:bg-(--bg-soft) focus-visible:outline-2 focus-visible:outline-(--app)"
          >
            {selected.length === 0 && <span className="text-(--ink-soft)">{emptyText}</span>}
            {/* สูงเท่าเดิมเสมอ (ผู้ใช้ 5/11/2569 "มันไม่รกเลยหรอ") — ชื่อแรก + จำนวนที่เหลือ กดช่องเพื่อดูครบ */}
            {selected.slice(0, 1).map((id) => (
              <span
                key={id}
                className="inline-flex min-w-0 items-center gap-1 rounded-[10px] border border-(--line) px-2 py-0.5 text-xs text-(--ink)"
                style={{ backgroundColor: chipBg }}
              >
                <span className="truncate">{labelOf(id)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    set(selected.filter((x) => x !== id));
                  }}
                  aria-label={`เอา ${labelOf(id)} ออก`}
                  className="shrink-0 text-[#EF5350]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {selected.length > 1 && (
              <span className="shrink-0 text-xs font-semibold text-(--ink-soft)" data-testid="picker-more">+{selected.length - 1}</span>
            )}
          </div>
        </>
      ) : (
        <>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-(--ink)">{heading}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(selected);
            setOpen(true);
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-(--radius) px-2 py-1 text-sm text-[#0F766E] hover:bg-(--bg-soft)"
        >
          {icon === "home" ? (
            <Plus className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {addLabel}
        </button>
      </div>

      {selected.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            setDraft(selected);
            setOpen(true);
          }}
          className="py-2 text-left text-[13px] text-(--ink-soft)"
        >
          {emptyText}
        </button>
      ) : (
        <div className="flex flex-wrap gap-2 py-1">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-[10px] border border-(--line) px-2 py-1 text-xs text-(--ink)"
              style={{ backgroundColor: chipBg }}
            >
              {labelOf(id)}
              <button
                type="button"
                onClick={() => set(selected.filter((x) => x !== id))}
                aria-label="ลบ"
                className="text-[#EF5350]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="border-b border-(--line) pt-1" />
        </>
      )}

      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}

      {open && (
        <Modal
          title={title}
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  set(draft.filter((id) => !exclude.includes(id)));
                  setOpen(false);
                }}
              >
                ตกลง
              </Button>
            </>
          }
        >
          {hint && (
            <p className="mb-2 text-xs text-(--ink-soft)">{hint}</p>
          )}
          {boxed && (
            <div className="sticky -top-4 z-10 -mx-1 mb-1 flex flex-col gap-1.5 bg-(--bg) px-1 pb-1.5 pt-1">
              {showSearch && (
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    // หน้าต่างอยู่ในฟอร์ม Enter ต้องไม่ส่งฟอร์มสร้างใบ
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    placeholder="พิมพ์เพื่อค้นหา"
                    aria-label="ค้นหาในรายชื่อ"
                    data-testid="picker-search"
                    className="h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) pl-9 pr-3 text-base text-(--ink) outline-none focus:border-(--app) sm:text-sm"
                  />
                </label>
              )}
              <p className="text-xs font-semibold text-(--ink)" data-testid="picker-count">เลือกแล้ว {draft.length}</p>
            </div>
          )}
          <div className="flex flex-col">
            {options
              .filter((o) => !exclude.includes(o.id))
              .filter((o) => !q || `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q))
              // คนที่เลือกไว้ขึ้นบนสุด กด +2 แล้วเห็นเลย (ผู้ใช้ 5/11/2569) · เรียงจากค่าตอนเปิด ติ๊กออกระหว่างดูแถวจะได้ไม่กระโดด
              .sort((a, b) => (boxed ? Number(selected.includes(b.id)) - Number(selected.includes(a.id)) : 0))
              .map((o) => (
                <label
                  key={o.id}
                  className="flex items-center gap-3 border-b border-(--line) py-2.5 text-sm last:border-0"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.includes(o.id)}
                    onChange={(e) =>
                      setDraft(
                        e.target.checked
                          ? [...draft, o.id]
                          : draft.filter((x) => x !== o.id)
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-(--ink)">{o.label}</span>
                    {o.sub && (
                      <span className="block text-xs text-(--ink-soft)">
                        {o.sub}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            {q && !options.some((o) => !exclude.includes(o.id) && `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q)) && (
              <p className="py-6 text-center text-sm text-(--ink-soft)">ไม่พบ &quot;{query.trim()}&quot;</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** ฟอร์มสร้างใบงาน: ผู้รับผิดชอบหลัก + CC ที่ตัดคนซ้ำกันออกให้ (เหมือนของเดิม) */
/** วาดลงกล่องอื่นในฟอร์มถ้ามี ไม่งั้นวาดตรงนี้ */
function renderInto(target: HTMLElement | null, node: React.ReactNode) {
  return target ? createPortal(node, target) : node;
}

/** ข้อในเช็กลิสต์ระหว่างกรอกฟอร์ม — ownerId null = ช่วยกันทำ / ยังไม่เลือก */
export type DraftItem = { text: string; ownerId: string | null };

export function AssigneeAndCc({
  users,
  defaultAssignee = "",
  allowGroup = true,
  defaultMembers = [],
  defaultRule = "all",
  defaultMemberDue = {},
  lockMode = false,
  withMemberDue = true,
  withChecklist = false,
  defaultChecklist = [],
  checklistSlotId,
}: {
  /** ผู้ที่มอบหมายงานได้ */
  users: PickOption[];
  defaultAssignee?: string;
  allowGroup?: boolean;
  /** แก้ทีมหลังสร้าง / แผน PM: คนในกลุ่มเดิม (ไม่รวม defaultAssignee) */
  defaultMembers?: string[];
  defaultRule?: string;
  defaultMemberDue?: Record<string, string>;
  /** มีคนกดเสร็จแล้ว: เปลี่ยนเดี่ยว/กลุ่มและวิธีปิดงานไม่ได้ */
  lockMode?: boolean;
  /** แผน PM ไม่มีวันส่งรายคน (วันตามรอบ) */
  withMemberDue?: boolean;
  /** แถวเช็กลิสต์ (ไม่บังคับ) ส่งค่าในช่อง checklist เป็น JSON [{ text, ownerId }] */
  withChecklist?: boolean;
  defaultChecklist?: DraftItem[];
  /** วางแถวเช็กลิสต์ไว้ที่อื่นในฟอร์ม (เช่น ในตัวเลือกขั้นสูง) — id ของกล่องปลายทาง */
  checklistSlotId?: string;
}) {
  // ลำดับที่เลือก: คนแรกคือ assignedTo คนที่เหลือคือสมาชิกกลุ่ม · ใบเดี่ยวมีคนเดียว
  const [picked, setPicked] = useState<string[]>(defaultAssignee ? [defaultAssignee, ...defaultMembers.filter((x) => x !== defaultAssignee)] : []);
  const [draft, setDraft] = useState<string[]>([]);
  const [group, setGroup] = useState(defaultMembers.length > 0);
  const [rule, setRule] = useState<"all" | "any" | "shared">(defaultRule === "any" || defaultRule === "shared" ? defaultRule : "all");
  const [checklist, setChecklist] = useState<DraftItem[]>(defaultChecklist);
  const [checkDraft, setCheckDraft] = useState<DraftItem[]>([]);
  const [checkOpen, setCheckOpen] = useState(false);
  const [newItem, setNewItem] = useState("");
  const perOwner = group && rule !== "shared";
  // กล่องปลายทางอยู่ในฟอร์มเดียวกัน ช่องซ่อนจึงยังถูกส่งไปกับฟอร์ม
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // กล่องปลายทางมีหลังเรนเดอร์แรกเท่านั้น (อยู่คนละคอมโพเนนต์)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (checklistSlotId) setSlot(document.getElementById(checklistSlotId));
  }, [checklistSlotId]);
  // กำหนดส่งแยกรายคน (เหมือนงานกลุ่ม) — ไม่ใส่ = ใช้กำหนดส่งของใบ
  const [memberDue, setMemberDue] = useState<Record<string, string>>(defaultMemberDue);
  const [dueDraft, setDueDraft] = useState<Record<string, string>>({});
  const [dueOpen, setDueOpen] = useState(false);
  const dueCount = picked.filter((id) => memberDue[id]).length;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const assignee = picked[0] ?? "";
  const q = query.trim().toLowerCase();
  const current = users.find((u) => u.id === assignee);
  const matches = users
    .filter((u) => !q || `${u.label} ${u.sub ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(picked.includes(b.id)) - Number(picked.includes(a.id)));

  const announce = () => requestAnimationFrame(() => selectRef.current?.dispatchEvent(new Event("change", { bubbles: true })));
  const openPicker = () => {
    setDraft(picked);
    setQuery("");
    setOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-wo-field="assignee">
    {/* ประเภท + ผู้รับผิดชอบ + ปิดงานเมื่อ วางแบบหน้าสร้างงาน (ผู้ใช้ 5/11/2569 "ใช้แบบของ task เลย") */}
    <div className="flex min-w-0 items-start gap-2">
      {allowGroup && (
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-xs text-(--ink-soft)">ประเภท</span>
          <div className="inline-flex h-10 items-center gap-0.5 rounded-lg border border-(--line) bg-(--bg-soft) p-0.5">
            {([[false, "เดี่ยว"], [true, "กลุ่ม"]] as const).map(([v, text]) => (
              <button
                key={text}
                type="button"
                aria-pressed={group === v}
                disabled={lockMode && group !== v}
                onClick={() => {
                  setGroup(v);
                  if (!v) setPicked((p) => p.slice(0, 1));
                }}
                className={`h-full rounded-md px-2.5 text-xs font-medium disabled:opacity-40 ${group === v ? "bg-white text-(--brand-navy) shadow-sm" : "text-(--ink-soft)"}`}
              >
                {text}
              </button>
            ))}
          </div>
          <input type="hidden" name="woMode" value={group ? "group" : "single"} />
          <input type="hidden" name="completionRule" value={rule} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="truncate text-xs text-(--ink-soft)">{group && picked.length > 0 ? `ผู้รับผิดชอบ · ${picked.length} คน *` : "ผู้รับผิดชอบ *"}</span>
      {/* select ตัวจริงยังอยู่ในฟอร์ม ตัวตรวจช่องบังคับ ใบส่วนตัว และ CC อ่านค่าจากตัวนี้ */}
      <select
        ref={selectRef}
        name="assignedTo"
        required
        value={assignee}
        onChange={(e) => setPicked(e.target.value ? [e.target.value, ...picked.slice(1).filter((x) => x !== e.target.value)] : [])}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      >
        <option value="" disabled>เลือกคน</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
      {picked.slice(1).map((id) => (
        <input key={id} type="hidden" name="groupMemberIds" value={id} />
      ))}
      <button
        type="button"
        onClick={openPicker}
        data-testid="assignee-field"
        title={picked.map((id) => users.find((u) => u.id === id)?.label).filter(Boolean).join(", ") || undefined}
        className="flex h-10 w-full items-center justify-between gap-1 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-left text-sm hover:bg-(--bg-soft)"
      >
        <span className={`truncate ${current ? "text-(--ink)" : "text-(--ink-soft)"}`}>{current?.label ?? (group ? "เลือกหลายคน" : "เลือกคน")}</span>
        <span className="flex shrink-0 items-center gap-1">
          {picked.length > 1 && <span className="text-xs font-semibold text-(--ink-soft)" data-testid="assignee-more">+{picked.length - 1}</span>}
          <ChevronDown className="h-4 w-4 text-(--ink-soft)" aria-hidden="true" />
        </span>
      </button>
      </div>
    </div>
      {group && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-(--ink-soft) max-[359px]:hidden">ปิดงานเมื่อ</span>
            <div className="inline-flex gap-0.5 rounded-md border border-(--line) bg-(--bg-soft) p-0.5">
              {([["all", "ครบทุกคน"], ["any", "คนใดคนหนึ่ง"], ["shared", "ช่วยกันทำ"]] as const).map(([v, text]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={rule === v}
                  disabled={lockMode && rule !== v}
                  onClick={() => setRule(v)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-40 ${rule === v ? "bg-white text-(--brand-navy) shadow-sm" : "text-(--ink-soft)"}`}
                >
                  {text}
                </button>
              ))}
            </div>
            {/* (i) อธิบายความต่าง แบบหน้าสร้างงาน (10/11/2569) */}
            <WoRuleInfo selected={rule as "all" | "any" | "shared"} />
          </div>
          <p className="text-[10px] leading-snug text-(--ink-soft)" data-testid="group-rule-hint">
            {rule === "all"
              ? "ทุกคนกดเสร็จ คนสุดท้ายปิดงาน · เลยกำหนดหักคนที่ยังไม่เสร็จ"
              : rule === "any"
                ? "ใครเสร็จก่อนปิดงานได้เลย · เลยกำหนดหักทุกคน"
                : "ใครในกลุ่มปิดงานก็ได้ · เลยกำหนดหักทุกคน"}
            {lockMode && " · มีคนกดเสร็จแล้ว เปลี่ยนวิธีปิดงานไม่ได้"}
          </p>
          {/* บรรทัดเดียว กดแล้วตั้งในหน้าต่าง ฟอร์มจะได้ไม่ยาวตามจำนวนคน (ผู้ใช้ 5/11/2569) */}
          {withMemberDue && (<>
          <button
            type="button"
            disabled={picked.length === 0}
            onClick={() => {
              setDueDraft(memberDue);
              setDueOpen(true);
            }}
            data-testid="member-due-open"
            className="mt-0.5 flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-(--line) px-2.5 text-left text-xs text-(--ink) hover:bg-(--bg-soft) disabled:opacity-50"
          >
            <span className="truncate">กำหนดส่งแยกรายคน</span>
            <span className="flex shrink-0 items-center gap-0.5 text-(--ink-soft)" data-testid="member-due-summary">
              {dueCount > 0 ? `ตั้งแล้ว ${dueCount} คน` : "ไม่แยก"}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </button>
          <input
            type="hidden"
            name="memberDueDates"
            value={dueCount > 0 ? JSON.stringify(Object.fromEntries(picked.filter((id) => memberDue[id]).map((id) => [id, memberDue[id]]))) : ""}
          />
          </>)}
        </div>
      )}

      {/* เช็กลิสต์ (ไม่บังคับ) — แถวเดียวแบบวันรายคน กดแล้วแก้ในหน้าต่าง */}
      {withChecklist && (!checklistSlotId || slot) && renderInto(slot, <>
          <button
            type="button"
            onClick={() => {
              setCheckDraft(checklist);
              setNewItem("");
              setCheckOpen(true);
            }}
            data-testid="checklist-open"
            className="mt-0.5 flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-(--line) px-2.5 text-left text-xs text-(--ink) hover:bg-(--bg-soft)"
          >
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              <ListChecks className="h-3.5 w-3.5 shrink-0 text-(--ink-soft)" aria-hidden="true" />
              เช็กลิสต์
            </span>
            <span className="flex shrink-0 items-center gap-0.5 text-(--ink-soft)" data-testid="checklist-summary">
              {checklist.length > 0 ? `${checklist.length} ข้อ` : "ไม่บังคับ"}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </button>
          <input
            type="hidden"
            name="checklist"
            value={checklist.length > 0 ? JSON.stringify(checklist.map((c) => ({ text: c.text, ownerId: perOwner ? (picked.includes(c.ownerId ?? "") ? c.ownerId : picked[0] ?? null) : null }))) : ""}
          />
        </>)}

      {checkOpen && (
        <Modal
          title="เช็กลิสต์"
          onClose={() => setCheckOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCheckOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="checklist-ok"
                onClick={() => {
                  const extra = newItem.trim() ? [{ text: newItem.trim(), ownerId: picked[0] ?? null }] : [];
                  setChecklist([...checkDraft.filter((c) => c.text.trim()), ...extra].slice(0, 40));
                  setCheckOpen(false);
                }}
              >
                ตกลง
              </Button>
            </>
          }
        >
          <p className="mb-2 text-xs text-(--ink-soft)" data-testid="checklist-rule-hint">
            {!group
              ? "ติ๊กครบทุกข้อถึงปิดงานได้"
              : rule === "shared"
                ? "ช่วยกันทำ: ใครในกลุ่มติ๊กข้อไหนก็ได้ ครบทุกข้อถึงปิดงานได้"
                : rule === "any"
                  ? "แต่ละข้อมีเจ้าของ · คนที่ติ๊กข้อของตัวเองครบก่อน ปิดงานได้"
                  : "แต่ละข้อมีเจ้าของ · ติ๊กข้อของตัวเองครบ = ส่วนของคนนั้นเสร็จ"}
          </p>
          <div className="flex flex-col gap-2">
            {checkDraft.map((c, i) => (
              <div key={i} className="flex min-w-0 items-center gap-1.5" data-testid="checklist-row">
                <input
                  value={c.text}
                  maxLength={200}
                  aria-label={`ข้อที่ ${i + 1}`}
                  onChange={(e) => setCheckDraft((d) => d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-(--line) bg-(--bg) px-2.5 text-base text-(--ink) sm:text-sm"
                />
                {perOwner && (
                  <select
                    value={picked.includes(c.ownerId ?? "") ? (c.ownerId ?? "") : (picked[0] ?? "")}
                    onChange={(e) => setCheckDraft((d) => d.map((x, j) => (j === i ? { ...x, ownerId: e.target.value } : x)))}
                    aria-label="เจ้าของข้อนี้"
                    data-testid="checklist-owner"
                    className="h-9 w-[38%] min-w-0 shrink-0 rounded-lg border border-(--line) bg-(--bg) px-1.5 text-xs text-(--ink)"
                  >
                    {picked.map((id) => (
                      <option key={id} value={id}>
                        {users.find((u) => u.id === id)?.label ?? id}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  aria-label="ลบข้อนี้"
                  onClick={() => setCheckDraft((d) => d.filter((_, j) => j !== i))}
                  className="shrink-0 p-1 text-(--ink-soft)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                value={newItem}
                maxLength={200}
                placeholder="พิมพ์ข้อใหม่ เช่น ล้างแผ่นกรอง"
                data-testid="checklist-new"
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (!newItem.trim() || checkDraft.length >= 40) return;
                  setCheckDraft((d) => [...d, { text: newItem.trim(), ownerId: picked[0] ?? null }]);
                  setNewItem("");
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-dashed border-(--line) bg-(--bg) px-2.5 text-base text-(--ink) sm:text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="checklist-add"
                disabled={!newItem.trim() || checkDraft.length >= 40}
                onClick={() => {
                  setCheckDraft((d) => [...d, { text: newItem.trim(), ownerId: picked[0] ?? null }]);
                  setNewItem("");
                }}
              >
                <Plus className="h-4 w-4" /> เพิ่ม
              </Button>
            </div>
            {perOwner && checkDraft.length > 0 && (
              <p className="text-[11px] text-(--ink-soft)">คนที่ไม่มีข้อของตัวเอง กด &quot;เสร็จส่วนของฉันแล้ว&quot; ในใบงานแทน</p>
            )}
          </div>
        </Modal>
      )}

      {dueOpen && (
        <Modal
          title="กำหนดส่งแยกรายคน"
          onClose={() => setDueOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDueOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setMemberDue(dueDraft);
                  setDueOpen(false);
                }}
              >
                ตกลง
              </Button>
            </>
          }
        >
          <p className="mb-2 text-xs text-(--ink-soft)">คนที่ไม่ใส่ใช้กำหนดส่งของใบ · เลยวันของใคร หักคนนั้น</p>
          <div className="flex flex-col gap-2">
            {picked.map((id) => (
              <div key={id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2" data-testid="member-due-row">
                <span className="truncate text-sm text-(--ink)">{users.find((u) => u.id === id)?.label ?? id}</span>
                <div className="flex min-w-0 items-center gap-1">
                  <DatePickerField
                    aboveModal
                    value={dueDraft[id] ?? ""}
                    minDate={todayBangkok()}
                    onChange={(v) => setDueDraft((m) => ({ ...m, [id]: v }))}
                    className="h-9 min-w-0 flex-1 text-(--ink)"
                  />
                  {dueDraft[id] && (
                    <button
                      type="button"
                      aria-label="ล้างวันที่"
                      onClick={() => setDueDraft((m) => ({ ...m, [id]: "" }))}
                      className="shrink-0 text-(--ink-soft)"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {open && (
        <Modal
          title={group ? "เลือกผู้รับผิดชอบหลายคน" : "เลือกผู้รับผิดชอบ"}
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              {group && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setPicked(draft);
                    setOpen(false);
                    announce();
                  }}
                >
                  ตกลง
                </Button>
              )}
            </>
          }
        >
          <div className="sticky -top-4 z-10 -mx-1 mb-1 flex flex-col gap-1.5 bg-(--bg) px-1 pb-1.5 pt-1">
            {users.length > SEARCH_FROM && (
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="พิมพ์เพื่อค้นหา"
                  aria-label="ค้นหาในรายชื่อ"
                  data-testid="picker-search"
                  className="h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) pl-9 pr-3 text-base text-(--ink) outline-none focus:border-(--app) sm:text-sm"
                />
              </label>
            )}
            {group && <p className="text-xs font-semibold text-(--ink)" data-testid="assignee-count">เลือกแล้ว {draft.length}</p>}
          </div>
          <div className="flex flex-col">
            {matches.map((u) =>
              group ? (
                <label key={u.id} className="flex items-center gap-3 border-b border-(--line) py-2.5 text-sm last:border-0">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.includes(u.id)}
                    onChange={(e) => setDraft(e.target.checked ? [...draft, u.id] : draft.filter((x) => x !== u.id))}
                  />
                  <span className="min-w-0">
                    <span className="block text-(--ink)">{u.label}</span>
                    {u.sub && <span className="block text-xs text-(--ink-soft)">{u.sub}</span>}
                  </span>
                </label>
              ) : (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setPicked([u.id]);
                    setOpen(false);
                    // CC ในตัวเลือกขั้นสูงฟังค่าจากฟอร์ม — ตั้งค่าด้วย state ไม่เกิด change เอง
                    announce();
                  }}
                  className="flex items-center justify-between gap-3 border-b border-(--line) py-2.5 text-left text-sm last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block text-(--ink)">{u.label}</span>
                    {u.sub && <span className="block text-xs text-(--ink-soft)">{u.sub}</span>}
                  </span>
                  {u.id === assignee && <Check className="h-4 w-4 shrink-0 text-(--brand-navy)" aria-label="เลือกอยู่" />}
                </button>
              ),
            )}
            {matches.length === 0 && <p className="py-6 text-center text-sm text-(--ink-soft)">ไม่พบ &quot;{query.trim()}&quot;</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
