import { useRef, useState } from "react";
import { Building2, Check, Crown, User, Users } from "lucide-react";
import { Button } from "@/modules/report_task/components/ui/button";
import { bulletsTextToHtml, htmlEditorToBulletsText, mentionMenuHorizontal } from "@/modules/report_task/lib/report-feed-rich-text";
import { isCoarsePointer } from "@/modules/report_task/lib/device";
import { cn } from "@/modules/report_task/lib/utils";
import { detectMentionTrigger, insertMentionChip, type MentionItem } from "./mention-utils";

/**
 * ช่องแก้ความคิดเห็น — เดิมเป็น textarea ธรรมดา: พิมพ์ @ ไม่มีรายชื่อขึ้น และแท็กเดิมโชว์เป็นโค้ดดิบ
 * `@[ชื่อ](user:…)` ("เวลากดแก้ไขคอมเม้นแล้ว @ ไม่ได้แล้ว") ⇒ ใช้ตัวแก้แบบเดียวกับช่องตอบ:
 * แท็กเป็นชิป · พิมพ์ @ มีเมนูเลือกคน/แผนก/ทุกคน/CEO · Enter บันทึก (จอสัมผัสกดปุ่ม) · Esc ยกเลิก
 */
/** เมนูรายชื่อของ @ — วางที่เคอร์เซอร์ เปิดขึ้นหรือลงตามที่ว่าง */
function MentionMenu({ menu, list, onPick }: { menu: { query: string; rect: DOMRect; containerTop: number; containerBottom: number; index: number }; list: MentionItem[]; onPick: (item: MentionItem) => void }) {
  const spaceBelow = menu.containerBottom - menu.rect.bottom - 8;
  const spaceAbove = menu.rect.top - menu.containerTop - 8;
  const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(120, Math.min(224, openAbove ? spaceAbove : spaceBelow));
  return (
    <div
      style={{
        position: "fixed",
        ...mentionMenuHorizontal(menu.rect.left),
        maxHeight,
        ...(openAbove ? { bottom: window.innerHeight - menu.rect.top + 4 } : { top: menu.rect.bottom + 4 }),
      }}
      data-keep-keyboard
      onMouseDown={(e) => e.preventDefault()}
      className="z-50 overflow-y-auto overscroll-contain rounded-lg border border-[var(--line)] bg-white py-1 shadow-lg"
    >
      {list.length === 0 ? (
        <p className="px-3 py-2 text-xs text-[var(--ink-soft)]">ไม่พบที่ตรงกับ &quot;{menu.query}&quot;</p>
      ) : (
        list.map((item, i) => {
          const Icon = item.type === "user" ? User : item.type === "everyone" ? Users : item.type === "role" ? Crown : Building2;
          return (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(item)}
              className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm", i === menu.index ? "bg-[var(--bg-soft)]" : "hover:bg-[var(--bg-soft)]")}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.sublabel && <span className="shrink-0 text-[11px] text-[var(--ink-soft)]">{item.sublabel}</span>}
            </button>
          );
        })
      )}
    </div>
  );
}

export function MentionEditBox({ initial, candidates, onSave, onCancel }: { initial: string; candidates: MentionItem[]; onSave: (body: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState(initial);
  const [menu, setMenu] = useState<{ query: string; rect: DOMRect; containerTop: number; containerBottom: number; index: number } | null>(null);

  const matches = (query: string) => {
    const q = query.trim().toLowerCase();
    return q ? candidates.filter((m) => m.label.toLowerCase().includes(q)) : candidates;
  };
  const sync = (el: HTMLElement) => {
    const t = detectMentionTrigger(el);
    setMenu(t ? { ...t, index: 0 } : null);
  };
  const pick = (item: MentionItem) => {
    const el = ref.current;
    if (!el || !insertMentionChip(el, item)) return;
    setMenu(null);
    setText(htmlEditorToBulletsText(el));
  };
  const save = () => {
    const body = ref.current ? htmlEditorToBulletsText(ref.current).trim() : text.trim();
    if (body) onSave(body);
  };

  return (
    <div className="mt-1 space-y-1.5">
      <div
        ref={(el) => {
          ref.current = el;
          // ไม่ควบคุมด้วย state (แบบเดียวกับช่องตอบ) — ใส่ข้อความเดิมครั้งเดียวตอนเปิด
          if (el && el.innerHTML === "") {
            el.innerHTML = bulletsTextToHtml(initial);
            el.focus();
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
          }
        }}
        contentEditable
        role="textbox"
        aria-label="แก้ไขความคิดเห็น"
        aria-multiline="true"
        suppressContentEditableWarning
        onInput={(e) => {
          setText(htmlEditorToBulletsText(e.currentTarget));
          sync(e.currentTarget);
        }}
        onKeyUp={(e) => sync(e.currentTarget)}
        onBlur={() => setMenu(null)}
        onKeyDown={(e) => {
          if (menu) {
            const list = matches(menu.query);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMenu({ ...menu, index: list.length === 0 ? 0 : (menu.index + 1) % list.length });
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setMenu({ ...menu, index: list.length === 0 ? 0 : (menu.index - 1 + list.length) % list.length });
              return;
            }
            // ไม่มีรายชื่อตรงคำที่พิมพ์ → Enter ทำงานปกติ (บันทึก) ไม่ติดค้างที่เมนูว่าง
            if ((e.key === "Enter" || e.key === "Tab") && list.length > 0) {
              e.preventDefault();
              pick(list[menu.index] ?? list[0]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMenu(null);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !isCoarsePointer()) {
            e.preventDefault();
            save();
          } else if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            document.execCommand("insertLineBreak");
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        className="max-h-40 min-h-[2.75rem] w-full overflow-y-auto break-words rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brand-green)]/50 [@media(pointer:coarse)]:text-base"
      />
      {menu && <MentionMenu menu={menu} list={matches(menu.query)} onPick={pick} />}
      <div className="flex items-center gap-1.5">
        <Button size="sm" className="h-6 px-2 text-xs" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={save}>
          <Check className="h-3 w-3" />
          บันทึก
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onCancel}>
          ยกเลิก
        </Button>
        <span className="text-[11px] text-[var(--ink-soft)]">พิมพ์ @ เพื่อแท็ก</span>
      </div>
    </div>
  );
}
