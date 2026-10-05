"use client";

import { useMemo, useRef, useState } from "react";
import { Clock, ImagePlus, Loader2, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { EmojiPicker } from "@/components/emoji-picker";
import { openStickerManager } from "@/components/sticker-manager";
import { addStickers, readRecentStickers, rememberSticker, stickersIn, useStickers, type Sticker } from "@/lib/stickers-client";

const COLS = 4;
const RECENT = "__recent__";
const GENERAL = "__general__";

/**
 * สติกเกอร์ของบริษัท — แตะแล้วส่งทันที (แบบ LINE) · แถบหมวดด้านบนตามลำดับที่แอดมินจัด · ใช้ล่าสุดก่อน
 * ค้นหาจากชื่อ/คำค้นข้ามทุกหมวด · แอดมินแชท: "เพิ่มรูป" (เลือกแล้วจบ เข้าหมวดที่เปิดอยู่) และ "จัดการ"
 */
export function StickerPanel({ onPick, className }: { onPick: (sticker: Sticker) => void; className?: string }) {
  const { packs, stickers, canManage, loaded } = useStickers();
  const [query, setQuery] = useState("");
  const [recent] = useState<string[]>(readRecentStickers);
  const [tab, setTab] = useState<string>(() => (recent.length > 0 ? RECENT : GENERAL));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasGeneral = stickers.some((s) => s.packId === null);
  const tabs = useMemo(
    () => [
      ...(recent.length > 0 ? [{ id: RECENT, label: "ล่าสุด" }] : []),
      ...(hasGeneral || packs.length === 0 ? [{ id: GENERAL, label: "ทั่วไป" }] : []),
      ...packs.map((p) => ({ id: p.id, label: p.name })),
    ],
    [recent.length, hasGeneral, packs]
  );
  const activeTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? GENERAL);

  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    if (q) return stickers.filter((s) => `${s.name} ${s.keywords}`.toLowerCase().includes(q));
    if (activeTab === RECENT) {
      const byId = new Map(stickers.map((s) => [s.id, s]));
      return recent.map((id) => byId.get(id)).filter((s): s is Sticker => Boolean(s));
    }
    return stickersIn(stickers, activeTab === GENERAL ? null : activeTab);
  }, [stickers, recent, activeTab, q]);

  const pick = (s: Sticker) => {
    rememberSticker(s.id);
    onPick(s);
  };

  async function quickAdd(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const target = activeTab === RECENT || activeTab === GENERAL ? null : activeTab;
    const { added, errors } = await addStickers(files, target);
    setUploading(false);
    if (added > 0) {
      toast.success(`เพิ่มสติกเกอร์ ${added} ตัวแล้ว`);
      if (activeTab === RECENT) setTab(GENERAL);
    }
    if (errors.length > 0) toast.error(errors.slice(0, 3).join("\n"));
  }

  return (
    <div className={cn("flex w-[22rem] max-w-full flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-(--line) bg-(--bg-soft) px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-(--ink-soft)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาสติกเกอร์"
            aria-label="ค้นหาสติกเกอร์"
            className="min-w-0 flex-1 bg-transparent text-sm text-(--ink) outline-none placeholder:text-(--ink-soft) [@media(pointer:coarse)]:text-base"
          />
        </label>
        {canManage && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/webp,image/gif,image/jpeg"
              className="hidden"
              onChange={(e) => {
                void quickAdd(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="เพิ่มรูปเข้าหมวดที่เปิดอยู่ (เลือกได้หลายรูป)"
              aria-label="เพิ่มรูปสติกเกอร์"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(--ink-soft) hover:bg-(--bg-soft) disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => openStickerManager(activeTab === RECENT || activeTab === GENERAL ? null : activeTab)}
              title="จัดการสติกเกอร์ (หมวด/เรียงลำดับ/ลบ)"
              aria-label="จัดการสติกเกอร์"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(--ink-soft) hover:bg-(--bg-soft)"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {!q && tabs.length > 1 && (
        <div role="tablist" aria-label="หมวดสติกเกอร์" className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                activeTab === t.id ? "bg-(--ink) text-(--bg)" : "bg-(--bg-soft) text-(--ink-soft) hover:text-(--ink)"
              )}
            >
              {t.id === RECENT && <Clock className="h-3 w-3" />}
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="h-64 overflow-y-auto overscroll-contain">
        {list.length > 0 ? (
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                title={s.name}
                aria-label={`ส่งสติกเกอร์ ${s.name}`}
                className="flex aspect-square w-full items-center justify-center rounded-lg p-1 hover:bg-(--bg-soft) focus-visible:bg-(--bg-soft) focus-visible:outline-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.name} loading="lazy" decoding="async" draggable={false} className="max-h-full max-w-full object-contain" />
              </button>
            ))}
          </div>
        ) : (
          <p className="px-2 py-8 text-center text-xs text-(--ink-soft)">
            {!loaded
              ? "กำลังโหลดสติกเกอร์…"
              : q
                ? `ไม่พบสติกเกอร์ที่ตรงกับ "${query.trim()}"`
                : stickers.length === 0
                  ? canManage
                    ? "ยังไม่มีสติกเกอร์ของบริษัท — กดรูปภาพด้านบนเพื่อเลือกรูปได้เลย"
                    : "ยังไม่มีสติกเกอร์ของบริษัท — แอดมินแชทเป็นคนเพิ่ม"
                  : "หมวดนี้ยังว่าง"}
          </p>
        )}
      </div>

    </div>
  );
}

/** ตัวเลือกรวม: แท็บ อิโมจิ | สติกเกอร์บริษัท — ปุ่มเดียวแบบ LINE/Facebook */
export function EmojiStickerPicker({
  onPickEmoji,
  onPickSticker,
  defaultTab,
}: {
  onPickEmoji: (emoji: string) => void;
  onPickSticker: (sticker: Sticker) => void;
  /** ไม่ระบุ = จอสัมผัสเปิดที่สติกเกอร์ (อิโมจิใช้จากคีย์บอร์ดเครื่อง) คอมเปิดที่อิโมจิ */
  defaultTab?: "emoji" | "sticker";
}) {
  const [tab, setTab] = useState<"emoji" | "sticker">(
    () => defaultTab ?? (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? "sticker" : "emoji")
  );
  const tabClass = (t: string) =>
    cn("flex-1 rounded-md py-1 text-xs font-semibold transition-colors", tab === t ? "bg-(--bg) text-(--ink) shadow-sm" : "text-(--ink-soft) hover:text-(--ink)");
  return (
    <div className="flex w-[22rem] max-w-full flex-col gap-2">
      <div role="tablist" className="flex gap-1 rounded-lg bg-(--bg-soft) p-0.5">
        <button type="button" role="tab" aria-selected={tab === "emoji"} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab("emoji")} className={tabClass("emoji")}>
          อิโมจิ
        </button>
        <button type="button" role="tab" aria-selected={tab === "sticker"} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab("sticker")} className={tabClass("sticker")}>
          สติกเกอร์บริษัท
        </button>
      </div>
      {tab === "emoji" ? <EmojiPicker onPick={onPickEmoji} /> : <StickerPanel onPick={onPickSticker} />}
    </div>
  );
}

/** สติกเกอร์ที่ส่งแล้ว — รูปลอย ไม่มีกรอบ แบบ LINE */
export function StickerImage({ url, name, className }: { url: string; name?: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name ?? "สติกเกอร์"} title={name} loading="lazy" decoding="async" draggable={false} className={cn("h-32 w-32 object-contain", className)} />;
}
