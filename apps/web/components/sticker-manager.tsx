"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, CheckSquare, GripVertical, ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { ChatModal } from "@/modules/chat/components/new-chat-dialog";

import {
  addStickers,
  createPack,
  deletePack,
  moveStickers,
  removeSticker,
  removeStickers,
  renamePack,
  reorderPacks,
  reorderStickersIn,
  stickersIn,
  updateSticker,
  useStickers,
  type Sticker,
  type StickerPack,
} from "@/lib/stickers-client";

/** หมวดเสมือนของสติกเกอร์ที่ยังไม่ได้จัดหมวด */
const GENERAL = "__general__";
const packKey = (id: string | null) => id ?? GENERAL;
const packOf = (key: string) => (key === GENERAL ? null : key);

/**
 * หน้าจัดการสติกเกอร์ของบริษัท (แอดมินแชท) — เปิดจาก ตั้งค่าแชท และจากตัวเลือกสติกเกอร์
 *  - หมวด: สร้าง · เปลี่ยนชื่อ · ลบ (สติกเกอร์ข้างในย้ายไป "ทั่วไป") · ลากเรียง
 *  - สติกเกอร์: เลือกรูป (หลายไฟล์ได้) แล้วจบ · ลากเรียงในหมวด · แตะเพื่อแก้ชื่อ/คำค้น/ย้ายหมวด/ลบ
 */
export function StickerManager({ initialPackId }: { initialPackId?: string | null }) {
  const { packs, stickers, canManage, loaded } = useStickers();
  const [current, setCurrent] = useState<string>(packKey(initialPackId ?? null));
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newPack, setNewPack] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // โหมดเลือกหลายตัว — null = ปิดอยู่ (แตะ = แก้ทีละตัว ลาก = เรียง) · เปิดแล้วแตะ = ติ๊กเลือก ลากไม่ได้
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const currentPack = packOf(current);
  // หมวดที่เลือกอยู่ถูกลบไปแล้ว → กลับ "ทั่วไป"
  const validCurrent = currentPack === null || packs.some((p) => p.id === currentPack) ? current : GENERAL;
  const list = useMemo(() => stickersIn(stickers, packOf(validCurrent)), [stickers, validCurrent]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stickers) m.set(packKey(s.packId), (m.get(packKey(s.packId)) ?? 0) + 1);
    return m;
  }, [stickers]);

  if (loaded && !canManage) {
    return <p className="px-4 py-8 text-center text-sm text-(--ink-soft)">เฉพาะแอดมินแชทจัดการสติกเกอร์ได้</p>;
  }

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setUploading({ done: 0, total: files.length });
    let added = 0;
    const errors: string[] = [];
    // ทีละไฟล์ — ตัวเลขความคืบหน้าขยับตามจริง
    for (const f of files) {
      const r = await addStickers([f], packOf(validCurrent));
      added += r.added;
      errors.push(...r.errors);
      setUploading({ done: added + errors.length, total: files.length });
    }
    setUploading(null);
    if (added > 0) toast.success(`เพิ่มสติกเกอร์ ${added} ตัวแล้ว`);
    if (errors.length > 0) toast.error(errors.slice(0, 3).join("\n"));
  }

  async function onPackDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = packs.map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    await reorderPacks(next).catch((err: Error) => toast.error(err.message));
  }

  async function onStickerDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = list.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    await reorderStickersIn(packOf(validCurrent), next).catch((err: Error) => toast.error(err.message));
  }

  async function submitNewPack() {
    const name = (newPack ?? "").trim();
    if (!name) return setNewPack(null);
    try {
      const pack = await createPack(name);
      setCurrent(pack.id);
      setNewPack(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างหมวดไม่สำเร็จ");
    }
  }

  // นับเฉพาะตัวที่ยังอยู่ในหมวดที่เปิดอยู่ — เปลี่ยนหมวดกลางคันแล้วของหมวดเก่าไม่ติดมาโดน
  const pickedIds = picked ? list.filter((s) => picked.has(s.id)).map((s) => s.id) : [];

  function closePicking() {
    setPicked(null);
    setConfirmBulkDelete(false);
  }

  function togglePicked(id: string) {
    setConfirmBulkDelete(false);
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    setBulkBusy(true);
    const r = await removeStickers(pickedIds);
    setBulkBusy(false);
    closePicking();
    if (r.done > 0) toast.success(`ลบสติกเกอร์ ${r.done} ตัวแล้ว`);
    if (r.failed > 0) toast.error(`ลบไม่สำเร็จ ${r.failed} ตัว`);
  }

  async function bulkMove(target: string) {
    setBulkBusy(true);
    const r = await moveStickers(pickedIds, packOf(target));
    setBulkBusy(false);
    closePicking();
    const name = target === GENERAL ? "ทั่วไป" : (packs.find((p) => p.id === target)?.name ?? "");
    if (r.done > 0) toast.success(`ย้าย ${r.done} ตัวไปหมวด "${name}" แล้ว`);
    if (r.failed > 0) toast.error(`ย้ายไม่สำเร็จ ${r.failed} ตัว`);
  }

  const currentName = currentPack === null ? "ทั่วไป" : (packs.find((p) => p.id === currentPack)?.name ?? "ทั่วไป");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* หมวด — ลากเรียงได้ (ทั่วไปอยู่หน้าสุดเสมอ) */}
      <div className="border-b border-(--line) px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-semibold text-(--ink-soft)">หมวด · ลากเพื่อเรียง</p>
          <button type="button" onClick={() => setNewPack("")} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-(--chat-accent-strong,var(--ink)) hover:bg-(--bg-soft)">
            <Plus className="h-3.5 w-3.5" /> หมวดใหม่
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <PackRow
            label="ทั่วไป"
            count={counts.get(GENERAL) ?? 0}
            active={validCurrent === GENERAL}
            onSelect={() => setCurrent(GENERAL)}
          />
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onPackDragEnd(e)}>
            <SortableContext items={packs.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {packs.map((p) => (
                <SortablePack
                  key={p.id}
                  pack={p}
                  count={counts.get(p.id) ?? 0}
                  active={validCurrent === p.id}
                  renaming={renaming === p.id}
                  onSelect={() => setCurrent(p.id)}
                  onStartRename={() => setRenaming(p.id)}
                  onRename={async (name) => {
                    setRenaming(null);
                    if (name.trim() && name.trim() !== p.name) await renamePack(p.id, name).catch((err: Error) => toast.error(err.message));
                  }}
                  onDelete={async () => {
                    await deletePack(p.id).then(
                      () => toast.success(`ลบหมวด "${p.name}" แล้ว — สติกเกอร์ย้ายไป "ทั่วไป"`),
                      (err: Error) => toast.error(err.message)
                    );
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
          {newPack !== null && (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitNewPack();
              }}
            >
              <input
                autoFocus
                value={newPack}
                onChange={(e) => setNewPack(e.target.value)}
                maxLength={30}
                placeholder="ชื่อหมวด เช่น ทีมช่าง"
                aria-label="ชื่อหมวดใหม่"
                className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--bg-soft) px-2.5 py-1.5 text-sm outline-none [@media(pointer:coarse)]:text-base"
              />
              <button type="submit" aria-label="สร้างหมวด" className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--chat-accent,var(--accent)) text-white">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setNewPack(null)} aria-label="ยกเลิก" className="flex h-8 w-8 items-center justify-center rounded-lg text-(--ink-soft) hover:bg-(--bg-soft)">
                <X className="h-4 w-4" />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* สติกเกอร์ในหมวด — เลือกรูปแล้วจบ · ลากเรียง · แตะเพื่อแก้ */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-(--ink)">
            {currentName} <span className="font-normal text-(--ink-soft)">· {list.length} ตัว</span>
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/webp,image/gif,image/jpeg"
            className="hidden"
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          {list.length > 0 && (
            <button
              type="button"
              onClick={() => (picked ? closePicking() : setPicked(new Set()))}
              aria-pressed={picked !== null}
              className={cn(
                "ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-(--line) px-2.5 text-sm font-medium text-(--ink) hover:bg-(--bg-soft)",
                picked && "bg-(--bg-soft)"
              )}
            >
              {picked ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
              {picked ? "เสร็จ" : "เลือกหลายตัว"}
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading !== null}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-(--chat-accent,var(--accent)) px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {uploading ? `กำลังเพิ่ม ${uploading.done}/${uploading.total}` : "เพิ่มรูป"}
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-(--ink-soft)">
          เลือกได้หลายรูปพร้อมกัน ไม่ต้องตั้งชื่อ · PNG/WebP พื้นใสดีที่สุด ระบบย่อเหลือ 320 px (ราว 20–80 KB ต่อตัว) · GIF เคลื่อนไหวไม่เกิน 1 MB · ลากเพื่อเรียง แตะเพื่อแก้ชื่อ/ย้ายหมวด/ลบ · กด “เลือกหลายตัว” เพื่อลบหรือย้ายหมวดทีละหลายตัว
        </p>

        {picked && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1.5 rounded-xl border border-(--line) bg-(--bg) px-2.5 py-2 text-xs shadow-sm">
            <span className="font-semibold text-(--ink)">เลือกแล้ว {pickedIds.length} ตัว</span>
            <button
              type="button"
              onClick={() => setPicked(pickedIds.length === list.length ? new Set() : new Set(list.map((s) => s.id)))}
              className="rounded-md px-1.5 py-1 font-medium text-(--chat-accent-strong,var(--ink)) hover:bg-(--bg-soft)"
            >
              {pickedIds.length === list.length ? "ไม่เลือกเลย" : "เลือกทั้งหมวด"}
            </button>
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {confirmBulkDelete ? (
                <>
                  <span className="text-(--danger)">ลบ {pickedIds.length} ตัวถาวร?</span>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => void bulkDelete()}
                    className="h-8 rounded-lg bg-(--danger) px-2.5 font-semibold text-white disabled:opacity-60"
                  >
                    {bulkBusy ? "กำลังลบ…" : "ยืนยันลบ"}
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => setConfirmBulkDelete(false)}
                    className="h-8 rounded-lg border border-(--line) px-2.5 text-(--ink)"
                  >
                    ยกเลิก
                  </button>
                </>
              ) : (
                <>
                  <select
                    value=""
                    disabled={bulkBusy || pickedIds.length === 0}
                    onChange={(e) => {
                      if (e.target.value) void bulkMove(e.target.value);
                    }}
                    aria-label="ย้ายที่เลือกไปหมวด"
                    className="h-8 max-w-40 rounded-lg border border-(--line) bg-(--bg-soft) px-2 text-(--ink) disabled:opacity-50 [@media(pointer:coarse)]:text-base"
                  >
                    <option value="">{bulkBusy ? "กำลังย้าย…" : "ย้ายไปหมวด…"}</option>
                    {[{ id: GENERAL, name: "ทั่วไป" }, ...packs]
                      .filter((p) => p.id !== validCurrent)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={bulkBusy || pickedIds.length === 0}
                    onClick={() => setConfirmBulkDelete(true)}
                    className="flex h-8 items-center gap-1 rounded-lg px-2.5 font-semibold text-(--danger) hover:bg-(--bg-soft) disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> ลบ
                  </button>
                </>
              )}
            </span>
          </div>
        )}

        {list.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-32 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-(--line) text-xs text-(--ink-soft) hover:bg-(--bg-soft)"
          >
            <ImagePlus className="h-6 w-6" /> ยังไม่มีสติกเกอร์ในหมวดนี้ — แตะเพื่อเลือกรูป
          </button>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onStickerDragEnd(e)}>
            <SortableContext items={list.map((s) => s.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {list.map((s) => (
                  <SortableSticker
                    key={s.id}
                    sticker={s}
                    picked={picked ? picked.has(s.id) : null}
                    onOpen={() => (picked ? togglePicked(s.id) : setEditing(s))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {editing && <StickerEditor sticker={editing} packs={packs} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PackRow({
  label,
  count,
  active,
  onSelect,
  handle,
  actions,
}: {
  label: React.ReactNode;
  count: number;
  active: boolean;
  onSelect: () => void;
  handle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-1 rounded-lg pr-1", active ? "bg-(--chat-accent-soft,var(--bg-soft))" : "hover:bg-(--bg-soft)")}>
      {handle ?? <span className="w-7 shrink-0" />}
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm">
        <span className={cn("min-w-0 flex-1 truncate", active ? "font-semibold text-(--ink)" : "text-(--ink)")}>{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-(--ink-soft)">{count}</span>
      </button>
      {actions}
    </div>
  );
}

function SortablePack({
  pack,
  count,
  active,
  renaming,
  onSelect,
  onStartRename,
  onRename,
  onDelete,
}: {
  pack: StickerPack;
  count: number;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pack.id });
  const [name, setName] = useState(pack.name);
  const [confirm, setConfirm] = useState(false);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10 opacity-80")}>
      {renaming ? (
        <form
          className="flex items-center gap-1.5 py-0.5 pl-7"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(name);
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onRename(name)}
            maxLength={30}
            aria-label="ชื่อหมวด"
            className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--bg-soft) px-2.5 py-1.5 text-sm outline-none [@media(pointer:coarse)]:text-base"
          />
        </form>
      ) : (
        <PackRow
          label={pack.name}
          count={count}
          active={active}
          onSelect={onSelect}
          handle={
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`ลากเพื่อเรียงหมวด ${pack.name}`}
              className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-(--ink-soft) active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          }
          actions={
            confirm ? (
              <span className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={onDelete} className="rounded-md bg-(--danger) px-2 py-1 text-xs font-semibold text-white">
                  ลบหมวด
                </button>
                <button type="button" onClick={() => setConfirm(false)} aria-label="ยกเลิก" className="flex h-7 w-7 items-center justify-center rounded-md text-(--ink-soft) hover:bg-(--bg)">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span className="flex shrink-0 items-center">
                <button type="button" onClick={onStartRename} aria-label={`เปลี่ยนชื่อหมวด ${pack.name}`} className="flex h-7 w-7 items-center justify-center rounded-md text-(--ink-soft) hover:bg-(--bg)">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setConfirm(true)} aria-label={`ลบหมวด ${pack.name}`} className="flex h-7 w-7 items-center justify-center rounded-md text-(--ink-soft) hover:bg-(--bg) hover:text-(--danger)">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            )
          }
        />
      )}
    </div>
  );
}

function SortableSticker({
  sticker,
  picked,
  onOpen,
}: {
  sticker: Sticker;
  /** null = ไม่ได้อยู่ในโหมดเลือกหลายตัว · true/false = ติ๊กอยู่หรือไม่ (โหมดนี้ลากเรียงไม่ได้) */
  picked: boolean | null;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sticker.id,
    disabled: picked !== null,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onOpen}
      title={sticker.name}
      aria-label={
        picked === null
          ? `${sticker.name} — แตะเพื่อแก้ ลากเพื่อเรียง`
          : `${sticker.name} — แตะเพื่อ${picked ? "เลิกเลือก" : "เลือก"}`
      }
      aria-pressed={picked ?? undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex aspect-square touch-manipulation items-center justify-center rounded-xl border border-(--line) bg-(--bg-soft) p-1.5 hover:border-(--ink-soft)",
        picked && "border-(--chat-accent,var(--accent)) ring-2 ring-(--chat-accent,var(--accent))",
        picked === false && "opacity-70",
        isDragging && "z-10 opacity-80 shadow-lg"
      )}
    >
      {picked !== null && (
        <span
          aria-hidden
          className={cn(
            "absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-md border",
            picked ? "border-(--chat-accent,var(--accent)) bg-(--chat-accent,var(--accent)) text-white" : "border-(--ink-soft) bg-(--bg)"
          )}
        >
          {picked && <Check className="h-3.5 w-3.5" />}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sticker.url} alt={sticker.name} draggable={false} loading="lazy" className="pointer-events-none max-h-full max-w-full object-contain" />
    </button>
  );
}

function StickerEditor({ sticker, packs, onClose }: { sticker: Sticker; packs: StickerPack[]; onClose: () => void }) {
  const [name, setName] = useState(sticker.name);
  const [keywords, setKeywords] = useState(sticker.keywords);
  const [packId, setPackId] = useState<string>(packKey(sticker.packId));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const patch: { name?: string; keywords?: string; packId?: string | null } = {};
      if (name.trim() !== sticker.name) patch.name = name;
      if (keywords.trim() !== sticker.keywords) patch.keywords = keywords;
      if (packOf(packId) !== sticker.packId) patch.packId = packOf(packId);
      if (Object.keys(patch).length > 0) await updateSticker(sticker.id, patch);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeSticker(sticker.id);
      toast.success(`ลบ "${sticker.name}" แล้ว`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-(--line) bg-(--bg-soft) px-2.5 py-2 text-sm text-(--ink) outline-none focus:border-(--ink-soft) [@media(pointer:coarse)]:text-base";

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="แก้สติกเกอร์"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full flex-col gap-3 rounded-t-2xl bg-(--bg) p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-sm sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-(--ink)">แก้สติกเกอร์</p>
          <button type="button" onClick={onClose} aria-label="ปิด" className="flex h-8 w-8 items-center justify-center rounded-lg text-(--ink-soft) hover:bg-(--bg-soft)">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-center rounded-xl bg-(--bg-soft) py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sticker.url} alt={sticker.name} className="h-28 w-28 object-contain" />
        </div>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          ชื่อ (ใช้ค้นหา)
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          คำค้นเพิ่มเติม (ไม่ใส่ก็ได้)
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={200} placeholder="เช่น ok โอเค ได้เลย" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          หมวด
          <select value={packId} onChange={(e) => setPackId(e.target.value)} className={field}>
            <option value={GENERAL}>ทั่วไป</option>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <button type="button" onClick={() => void remove()} disabled={busy} className="h-10 flex-1 rounded-lg bg-(--danger) text-sm font-semibold text-white disabled:opacity-60">
              ยืนยันลบ
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-(--danger) hover:bg-(--bg-soft)">
              <Trash2 className="h-4 w-4" /> ลบ
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !name.trim()}
            className="h-10 flex-1 rounded-lg bg-(--chat-accent,var(--accent)) text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
        <p className="text-[11px] text-(--ink-soft)">ลบแล้วสติกเกอร์หายจากชุด ข้อความที่เคยส่งไปแล้วยังแสดงอยู่</p>
      </div>
    </div>
  );
}

// ─── เปิดหน้าจัดการจากที่ไหนก็ได้ ───
// ตัวเลือกสติกเกอร์อยู่ในป๊อปอัปที่ปิดเองเมื่อคลิกนอกกรอบ — ถ้าเปิดหน้าจัดการจากข้างในป๊อปอัป
// คลิกแรกในหน้าจัดการจะปิดป๊อปอัป แล้วหน้าจัดการก็หายตามไปด้วย ⇒ เปิดที่ตัวกลางระดับ shell แทน
let openPack: string | null | undefined;
const hostListeners = new Set<() => void>();

export function openStickerManager(packId: string | null = null): void {
  openPack = packId;
  hostListeners.forEach((l) => l());
}

function closeStickerManager(): void {
  openPack = undefined;
  hostListeners.forEach((l) => l());
}

export function StickerManagerHost() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    hostListeners.add(l);
    return () => {
      hostListeners.delete(l);
    };
  }, []);
  if (openPack === undefined) return null;
  return (
    <ChatModal title="จัดการสติกเกอร์บริษัท" onClose={closeStickerManager} layer="top">
      <StickerManager initialPackId={openPack} />
    </ChatModal>
  );
}
