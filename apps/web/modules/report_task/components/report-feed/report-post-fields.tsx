"use client";

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { departments, users } from "@/modules/report_task/lib/directory";
import { useReportFeedStore, type ReportPostImage, type ReportPostSection } from "@/modules/report_task/store/report-feed-store";
import {
  BULLET_LINE_PREFIX,
  BULLET_MARKER,
  CHECKLIST_LINE_PREFIX,
  CHECKLIST_UNCHECKED,
  HORIZONTAL_RULE_LINE,
  NUMBERED_LINE_PREFIX,
  bulletsTextToHtml,
  htmlEditorToBulletsText,
  numberedMarker,
  type MentionType,
} from "@/modules/report_task/lib/report-feed-rich-text";
import { cn } from "@/modules/report_task/lib/utils";
import { AlbumPickerButton } from "@/modules/report_task/components/report-feed/album-picker-button";
import { Bold, Building2, Code, Hash, ImagePlus, Italic, List, ListOrdered, Minus, Plus, Square, Table, Trash2, TriangleAlert, Underline, User, X } from "lucide-react";
import { LinkInsertPopover } from "@/modules/report_task/components/report-feed/link-insert-popover";

interface MentionItem {
  type: MentionType;
  id: string;
  label: string;
  sublabel?: string;
}

/** MIME type a draggable room row (topic-sidebar.tsx) puts on the drag event so dropping it here inserts a room mention directly — same result as typing "@ห้องชื่อ" and picking it. */
export const DRAG_MENTION_TOPIC_MIME = "application/x-mention-topic";

export type DraftSection = ReportPostSection & { bulletsText: string };

export const newSection = (): DraftSection => ({
  id: `sec-${crypto.randomUUID()}`,
  heading: "",
  bullets: [],
  bulletsText: "",
});

type ActiveFormat = { bold: boolean; italic: boolean; underline: boolean; code: boolean; list: "bullet" | "number" | "checklist" | null };
const NO_ACTIVE_FORMAT: ActiveFormat = { bold: false, italic: false, underline: false, code: false, list: null };

/** Text of the editor content from its start up to the caret, via a cloned range — reuses the same line/br serializer as final storage. */
function textBeforeCaret(el: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).startContainer)) return null;
  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.endContainer, range.endOffset);
  const wrapper = document.createElement("div");
  wrapper.appendChild(preRange.cloneContents());
  return htmlEditorToBulletsText(wrapper);
}

function currentLineListMatch(el: HTMLElement) {
  const before = textBeforeCaret(el);
  if (before === null) return { numberedMatch: null, bulletMatch: null, checklistMatch: null, currentLine: "" };
  const lines = before.split("\n");
  // split() คืนอย่างน้อยหนึ่งสมาชิกเสมอ แม้สตริงว่าง
  const currentLine = lines[lines.length - 1]!;
  const numberedMatch = currentLine.match(NUMBERED_LINE_PREFIX);
  const bulletMatch = !numberedMatch ? currentLine.match(BULLET_LINE_PREFIX) : null;
  const checklistMatch = !numberedMatch && !bulletMatch ? currentLine.match(CHECKLIST_LINE_PREFIX) : null;
  return { numberedMatch, bulletMatch, checklistMatch, currentLine };
}

export function ReportPostFields({
  topicId,
  title,
  onTitleChange,
  sections,
  onSectionsChange,
  images,
  onImagesChange,
  minImages,
  fileInputRef,
  busy,
  onFilesSelected,
}: {
  /** Which room's albums the whole-post album picker offers — see AlbumPickerButton. */
  topicId: string;
  title: string;
  onTitleChange: (v: string) => void;
  sections: DraftSection[];
  onSectionsChange: (v: DraftSection[]) => void;
  images: ReportPostImage[];
  onImagesChange: (v: ReportPostImage[]) => void;
  /** Minimum photos required before this post can be submitted (0 = not required). */
  minImages: number;
  fileInputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  onFilesSelected: (files: FileList | null) => void;
}) {
  const editableRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeFormat, setActiveFormat] = useState<Record<string, ActiveFormat>>({});
  // The editor is uncontrolled: its DOM is the source of truth once mounted
  // (onInput pushes changes out to `sections`, but nothing pushes back in).
  // dangerouslySetInnerHTML still gets re-applied by React on every re-render
  // even when the __html string is unchanged from the last render — so the
  // initial content is set imperatively, once, via the ref callback instead,
  // which React never revisits.
  const initializedIds = useRef<Set<string>>(new Set());

  // Typing "@" opens a mention picker over people, rooms, and departments —
  // a picked item is inserted as a non-editable chip and stored as
  // `@[label](type:id)` (see report-feed-rich-text.tsx), so it round-trips
  // through the plain-text bullet storage the same way bold/links already do.
  // Dragging a room straight from the sidebar and dropping it here (see
  // handleMentionDrop) inserts the same chip without the "@" round-trip.
  const topics = useReportFeedStore((s) => s.topics);
  const mentionCandidates = useMemo<MentionItem[]>(
    () => [
      ...users.map((u): MentionItem => ({ type: "user", id: u.id, label: u.name, sublabel: u.role })),
      ...topics.map((t): MentionItem => ({ type: "topic", id: t.id, label: t.name, sublabel: "ห้อง Report" })),
      ...departments.map((d): MentionItem => ({ type: "dept", id: d.id, label: d.name, sublabel: "แผนก" })),
    ],
    [topics]
  );
  const [mentionMenu, setMentionMenu] = useState<{ sectionId: string; query: string; rect: DOMRect; containerTop: number; containerBottom: number; index: number } | null>(null);

  function mentionMatches(query: string): MentionItem[] {
    const q = query.trim().toLowerCase();
    const all = q ? mentionCandidates.filter((m) => m.label.toLowerCase().includes(q)) : mentionCandidates;
    return all.slice(0, 8);
  }

  /** Top/bottom edges of the nearest scrollable ancestor (the composer's own scroll area) — the dropdown must stay within these, not just the viewport edges, or it visually spills past the composer card into the page header above or the footer buttons below. */
  function nearestScrollableBounds(el: HTMLElement): { top: number; bottom: number } {
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }
      node = node.parentElement;
    }
    return { top: 0, bottom: window.innerHeight };
  }

  /** An "@word" ending exactly at the caret, in the same text node — good enough for the normal case of typing "@" then a query with no interruption. */
  function detectMentionTrigger(el: HTMLElement): { query: string; rect: DOMRect; containerTop: number; containerBottom: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || !el.contains(sel.getRangeAt(0).startContainer)) return null;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const before = (node.textContent ?? "").slice(0, range.startOffset);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return null;
    const caretRange = range.cloneRange();
    const rect = caretRange.getClientRects()[0] ?? caretRange.getBoundingClientRect();
    const bounds = nearestScrollableBounds(el);
    return { query: match[1]!, rect, containerTop: bounds.top, containerBottom: bounds.bottom };
  }

  function syncMentionMenu(sectionId: string, el: HTMLElement) {
    const trigger = detectMentionTrigger(el);
    setMentionMenu(trigger ? { sectionId, query: trigger.query, rect: trigger.rect, containerTop: trigger.containerTop, containerBottom: trigger.containerBottom, index: 0 } : null);
  }

  function makeMentionChip(item: MentionItem): HTMLSpanElement {
    const chip = document.createElement("span");
    chip.className = "mention-chip inline-flex items-center rounded bg-[var(--accent)] text-[var(--brand-green-dark)] px-1 font-medium";
    chip.contentEditable = "false";
    chip.setAttribute("data-mention-type", item.type);
    chip.setAttribute("data-mention-id", item.id);
    chip.textContent = `@${item.label}`;
    return chip;
  }

  function insertMention(sectionId: string, item: MentionItem) {
    const el = editableRefs.current[sectionId];
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? "";
    const before = text.slice(0, range.startOffset);
    const atIndex = before.lastIndexOf("@");
    if (atIndex === -1) return;
    const afterCaret = text.slice(range.startOffset);
    const parent = node.parentNode;
    if (!parent) return;

    const chip = makeMentionChip(item);
    // spaceNode below already supplies the single space after the chip —
    // don't also fall back to " " here or a mention typed at end-of-line
    // ends up with two spaces after it.
    const afterNode = document.createTextNode(afterCaret);
    const spaceNode = document.createTextNode(" ");
    parent.replaceChild(afterNode, node);
    parent.insertBefore(document.createTextNode(text.slice(0, atIndex)), afterNode);
    parent.insertBefore(chip, afterNode);
    parent.insertBefore(spaceNode, afterNode);

    const newRange = document.createRange();
    newRange.setStart(spaceNode, spaceNode.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setMentionMenu(null);
    syncFromEditor(sectionId, el);
  }

  /**
   * A safety net for whoever types a candidate's full name by hand instead
   * of picking it from the dropdown (easy to do without noticing — the
   * plain "@ชื่อเต็ม" just sits there as ordinary text otherwise, looking
   * like a broken mention next to real chips). Runs on blur: walks the
   * editor's text nodes looking for a literal "@<candidate label>" and
   * swaps the first one found for a real chip, repeating until nothing more
   * matches. Longer labels are tried first so "ทีมพัฒนา (ตัวอย่าง)" wins
   * over a shorter name that happens to be a prefix of it.
   */
  function autoLinkifyMentions(sectionId: string, el: HTMLDivElement) {
    const sorted = [...mentionCandidates].sort((a, b) => b.label.length - a.label.length);
    function replaceOne(node: Node): boolean {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        for (const item of sorted) {
          const needle = `@${item.label}`;
          const idx = text.indexOf(needle);
          if (idx === -1) continue;
          const parent = node.parentNode;
          if (!parent) continue;
          const afterNode = document.createTextNode(text.slice(idx + needle.length));
          parent.replaceChild(afterNode, node);
          parent.insertBefore(document.createTextNode(text.slice(0, idx)), afterNode);
          parent.insertBefore(makeMentionChip(item), afterNode);
          return true;
        }
        return false;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if ((node as HTMLElement).classList?.contains("mention-chip")) return false; // already a chip, don't re-scan its own "@label" text
      for (const child of Array.from(node.childNodes)) {
        if (replaceOne(child)) return true;
      }
      return false;
    }
    let changed = false;
    while (replaceOne(el)) changed = true;
    if (changed) syncFromEditor(sectionId, el);
  }

  function handleMentionDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes(DRAG_MENTION_TOPIC_MIME)) return; // leave normal text/file drag-drop alone
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  // Dragging a room straight from the sidebar and dropping it into the
  // editor inserts the same mention chip typing "@ห้องชื่อ" and picking it
  // would — no keyboard round-trip needed for the common "tag this room" case.
  function handleMentionDrop(sectionId: string, e: DragEvent<HTMLDivElement>) {
    const raw = e.dataTransfer.getData(DRAG_MENTION_TOPIC_MIME);
    if (!raw) return;
    e.preventDefault();
    const el = editableRefs.current[sectionId];
    if (!el) return;
    let item: MentionItem;
    try {
      const parsed = JSON.parse(raw) as { id: string; name: string };
      item = { type: "topic", id: parsed.id, label: parsed.name };
    } catch {
      return;
    }

    el.focus();
    const docWithCaretApis = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let range: Range | null = docWithCaretApis.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
    if (!range) {
      const pos = docWithCaretApis.caretPositionFromPoint?.(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range || !el.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }

    const chip = makeMentionChip(item);
    const spaceNode = document.createTextNode(" ");
    const frag = document.createDocumentFragment();
    frag.appendChild(chip);
    frag.appendChild(spaceNode);
    range.deleteContents();
    range.insertNode(frag);

    const newRange = document.createRange();
    newRange.setStartAfter(spaceNode);
    newRange.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(newRange);

    syncFromEditor(sectionId, el);
  }

  function updateSection(id: string, patch: Partial<{ heading: string; bulletsText: string }>) {
    onSectionsChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function syncFromEditor(sectionId: string, el: HTMLDivElement) {
    updateSection(sectionId, { bulletsText: htmlEditorToBulletsText(el) });
    syncActiveFormat(sectionId, el);
    syncMentionMenu(sectionId, el);
  }

  // Keeps the toolbar buttons highlighted for whatever formatting is live at
  // the caret — native queryCommandState for bold/italic/underline, and our
  // own line-prefix check for the list buttons (no execCommand equivalent).
  function syncActiveFormat(sectionId: string, el: HTMLDivElement) {
    const { numberedMatch, bulletMatch, checklistMatch } = currentLineListMatch(el);
    setActiveFormat((prev) => ({
      ...prev,
      [sectionId]: {
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        code: !!window.getSelection()?.anchorNode?.parentElement?.closest("code"),
        list: numberedMatch ? "number" : bulletMatch ? "bullet" : checklistMatch ? "checklist" : null,
      },
    }));
  }

  // Preserves the current selection through the toolbar button click — a
  // plain click blurs the editor (and drops the selection) before onClick fires.
  function preserveSelection(e: MouseEvent) {
    e.preventDefault();
  }

  function exec(sectionId: string, command: string, value?: string) {
    const el = editableRefs.current[sectionId];
    if (!el) return;
    el.focus();
    document.execCommand(command, false, value);
    syncFromEditor(sectionId, el);
  }

  function toggleCode(sectionId: string) {
    const el = editableRefs.current[sectionId];
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const selectedText = sel?.toString();
    document.execCommand("insertHTML", false, `<code>${selectedText || "ข้อความ"}</code>`);
    syncFromEditor(sectionId, el);
  }

  // Bullet/number/hr/table insert buttons should start their own line, not
  // splice into whatever text the caret happens to be sitting inside. Fully
  // manual Range insertion (no execCommand) — chaining a Range setup with a
  // separate execCommand call doesn't reliably land at the position the
  // Range was just moved to (same issue the Enter handler hit).
  function insertSnippet(sectionId: string, snippet: string) {
    const el = editableRefs.current[sectionId];
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();

    const { currentLine } = currentLineListMatch(el);
    if (currentLine !== "") {
      const leadingBr = document.createElement("br");
      range.insertNode(leadingBr);
      range.setStartAfter(leadingBr);
      range.collapse(true);
    }

    for (const [i, line] of snippet.split("\n").entries()) {
      if (i > 0) {
        const br = document.createElement("br");
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
      }
      const textNode = document.createTextNode(line);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
    }

    sel.removeAllRanges();
    sel.addRange(range);
    syncFromEditor(sectionId, el);
  }

  function insertNumberedLine(sectionId: string) {
    const el = editableRefs.current[sectionId];
    if (!el) return;
    const { numberedMatch } = currentLineListMatch(el);
    const n = numberedMatch ? parseInt(numberedMatch[1]!, 10) + 1 : 1;
    insertSnippet(sectionId, numberedMarker(n));
  }

  // A bare http(s) URL is all renderRichBulletText needs to linkify a
  // bullet — no separate marker syntax, so pasting/typing one directly
  // works the same as clicking this button.
  function insertLink(sectionId: string, url: string) {
    insertSnippet(sectionId, url);
  }

  /** The <br> immediately before the caret, or null if the caret is on the editor's first line. */
  function lastBrBeforeCaret(el: HTMLDivElement, caretRange: Range): HTMLElement | null {
    let last: HTMLElement | null = null;
    for (const br of Array.from(el.querySelectorAll("br"))) {
      const brRange = document.createRange();
      brRange.selectNode(br);
      // brRange's end at-or-before the caret's start means this <br> precedes the caret.
      if (brRange.compareBoundaryPoints(Range.END_TO_START, caretRange) <= 0) {
        last = br;
      } else {
        break;
      }
    }
    return last;
  }

  /**
   * Always inserts an explicit <br> (never lets the browser wrap lines in
   * <div>, which varies by browser) — continuing a bulleted/numbered line
   * with the next marker when the caret sits on one, same as Word/Teams.
   * Pressing Enter on an EMPTY list line exits the list instead of piling up
   * more empty markers — same as Word/Teams: it clears that line's marker
   * rather than starting a new one below it.
   * Uses direct Range manipulation rather than chained execCommand calls:
   * execCommand doesn't reliably leave the caret positioned for a second
   * call to build on, and insertHTML collapses the trailing space "N. " needs.
   */
  function handleEditorKeyDown(sectionId: string, e: KeyboardEvent<HTMLDivElement>) {
    if (mentionMenu?.sectionId === sectionId) {
      const matches = mentionMatches(mentionMenu.query);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionMenu({ ...mentionMenu, index: matches.length === 0 ? 0 : (mentionMenu.index + 1) % matches.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionMenu({ ...mentionMenu, index: matches.length === 0 ? 0 : (mentionMenu.index - 1 + matches.length) % matches.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = matches[mentionMenu.index];
        if (picked) insertMention(sectionId, picked);
        else setMentionMenu(null);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionMenu(null);
        return;
      }
    }

    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    // A non-collapsed selection (the user dragged across text, possibly
    // spanning several list lines) must be deleted BEFORE deciding whether
    // to continue a list — deciding first, from the selection's end, then
    // deleting the whole selection anyway just left the leftover marker
    // with none of the selected content ever surviving.
    if (!range.collapsed) {
      range.deleteContents();
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const { numberedMatch, bulletMatch, checklistMatch, currentLine } = currentLineListMatch(el);
    const match = numberedMatch ?? bulletMatch ?? checklistMatch;

    if (match && currentLine.trim() === match[0]!.trim()) {
      // Empty list line — clear its marker instead of continuing the list.
      const lineStart = document.createRange();
      const priorBr = lastBrBeforeCaret(el, range);
      if (priorBr) lineStart.setStartAfter(priorBr);
      else lineStart.setStart(el, 0);
      lineStart.setEnd(range.startContainer, range.startOffset);
      lineStart.deleteContents();
      sel.removeAllRanges();
      sel.addRange(lineStart);
      syncFromEditor(sectionId, el);
      return;
    }

    const prefix = numberedMatch
      ? numberedMarker(parseInt(numberedMatch[1]!, 10) + 1)
      : bulletMatch
        ? BULLET_MARKER
        : checklistMatch
          ? CHECKLIST_UNCHECKED
          : "";
    range.deleteContents();
    const br = document.createElement("br");
    range.insertNode(br);
    range.setStartAfter(br);
    if (prefix) {
      const textNode = document.createTextNode(prefix);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    syncFromEditor(sectionId, el);
  }

  return (
    <div className="space-y-3">
      <Input
        aria-label="หัวข้อรีพอต"
        placeholder="หัวข้อรีพอต เช่น สรุปอัปเดตประจำสัปดาห์"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="font-medium"
      />

      <div className="space-y-3">
        {/* react-hooks/refs (React Compiler's ref-in-render check) flags this
            map body, but every `.current` read below happens inside a ref
            callback or an event handler (exec/toggleCode/insertSnippet/
            insertMention/etc.) — the pattern React's own docs call safe.
            Verified: an isolated repro of the same ref-callback pattern alone
            doesn't trip the rule, and stripping the mention feature's JSX/
            hook usage one piece at a time didn't clear it either — this is
            the rule hitting a complexity ceiling on an already ref-heavy
            uncontrolled editor, not a real stale-closure bug (confirmed
            working correctly in the browser). */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {sections.map((s, i) => {
          const fmt = activeFormat[s.id] ?? NO_ACTIVE_FORMAT;
          const toolbarBtn = (active: boolean) =>
            cn(
              "h-6 w-6 flex items-center justify-center rounded",
              active ? "bg-[var(--ink)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
            );
          return (
            <div key={s.id} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`หัวข้อย่อย ${i + 1}`}
                  placeholder={`หัวข้อย่อย ${i + 1} (เช่น บั๊กที่เจอและแก้)`}
                  value={s.heading}
                  onChange={(e) => updateSection(s.id, { heading: e.target.value })}
                  className="text-sm font-medium"
                />
                {sections.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-[var(--ink-soft)] hover:text-[var(--chart-red)]"
                    onClick={() => onSectionsChange(sections.filter((x) => x.id !== s.id))}
                    aria-label="ลบหัวข้อย่อยนี้"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                <button type="button" onMouseDown={preserveSelection} onClick={() => exec(s.id, "bold")} className={toolbarBtn(fmt.bold)} aria-label="ตัวหนา" title="ตัวหนา">
                  <Bold className="h-3.5 w-3.5" />
                </button>
                <button type="button" onMouseDown={preserveSelection} onClick={() => exec(s.id, "italic")} className={toolbarBtn(fmt.italic)} aria-label="ตัวเอียง" title="ตัวเอียง">
                  <Italic className="h-3.5 w-3.5" />
                </button>
                <button type="button" onMouseDown={preserveSelection} onClick={() => exec(s.id, "underline")} className={toolbarBtn(fmt.underline)} aria-label="ขีดเส้นใต้" title="ขีดเส้นใต้">
                  <Underline className="h-3.5 w-3.5" />
                </button>
                <span className="w-px h-4 bg-[var(--line)] mx-0.5" />
                <button
                  type="button"
                  onMouseDown={preserveSelection}
                  onClick={() => insertSnippet(s.id, BULLET_MARKER)}
                  className={toolbarBtn(fmt.list === "bullet")}
                  aria-label="สัญลักษณ์หัวข้อย่อย"
                  title="สัญลักษณ์หัวข้อย่อย"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={preserveSelection}
                  onClick={() => insertNumberedLine(s.id)}
                  className={toolbarBtn(fmt.list === "number")}
                  aria-label="ลำดับเลข"
                  title="ลำดับเลข"
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={preserveSelection}
                  onClick={() => insertSnippet(s.id, CHECKLIST_UNCHECKED)}
                  className={toolbarBtn(fmt.list === "checklist")}
                  aria-label="เช็คลิสต์"
                  title="เช็คลิสต์"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
                <span className="w-px h-4 bg-[var(--line)] mx-0.5" />
                <button type="button" onMouseDown={preserveSelection} onClick={() => toggleCode(s.id)} className={toolbarBtn(fmt.code)} aria-label="โค้ด" title="โค้ด">
                  <Code className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={preserveSelection}
                  onClick={() => insertSnippet(s.id, HORIZONTAL_RULE_LINE)}
                  className={toolbarBtn(false)}
                  aria-label="เส้นคั่น"
                  title="เส้นคั่น"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={preserveSelection}
                  onClick={() => insertSnippet(s.id, "| หัวข้อ 1 | หัวข้อ 2 |\n| แถวที่ 1 | แถวที่ 2 |")}
                  className={toolbarBtn(false)}
                  aria-label="แทรกตาราง"
                  title="แทรกตาราง"
                >
                  <Table className="h-3.5 w-3.5" />
                </button>
                <LinkInsertPopover onInsert={(url) => insertLink(s.id, url)} className={toolbarBtn(false)} />
              </div>
              <div
                ref={(el) => {
                  editableRefs.current[s.id] = el;
                  if (el && !initializedIds.current.has(s.id)) {
                    el.innerHTML = bulletsTextToHtml(s.bulletsText);
                    initializedIds.current.add(s.id);
                  }
                }}
                data-tour={i === 0 ? "composer-textbox" : undefined}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label={s.heading ? `เนื้อหา: ${s.heading}` : "เนื้อหารายงาน"}
                data-placeholder="พิมพ์แต่ละบรรทัด = แต่ละบูลเล็ต, ลากห้องจากแถบด้านซ้ายมาวางเพื่อแท็กได้เลย"
                onInput={(e) => syncFromEditor(s.id, e.currentTarget)}
                onKeyDown={(e) => handleEditorKeyDown(s.id, e)}
                onKeyUp={(e) => syncActiveFormat(s.id, e.currentTarget)}
                onMouseUp={(e) => syncActiveFormat(s.id, e.currentTarget)}
                onBlur={(e) => autoLinkifyMentions(s.id, e.currentTarget)}
                onDragOver={handleMentionDragOver}
                onDrop={(e) => handleMentionDrop(s.id, e)}
                className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground"
              />
              {mentionMenu?.sectionId === s.id && (() => {
                const matches = mentionMatches(mentionMenu.query);
                // Prefer opening below the caret, but flip above it whenever
                // there isn't enough room before the composer's own scroll
                // area ends — otherwise the dropdown visually spills past
                // the composer card into its footer buttons underneath.
                const spaceBelow = mentionMenu.containerBottom - mentionMenu.rect.bottom - 8;
                const spaceAbove = mentionMenu.rect.top - mentionMenu.containerTop - 8;
                const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
                const maxHeight = Math.max(120, Math.min(224, openAbove ? spaceAbove : spaceBelow));
                return (
                  <div
                    style={{
                      position: "fixed",
                      left: mentionMenu.rect.left,
                      maxHeight,
                      ...(openAbove
                        ? { bottom: window.innerHeight - mentionMenu.rect.top + 4 }
                        : { top: mentionMenu.rect.bottom + 4 }),
                    }}
                    className="z-50 w-64 rounded-lg border border-[var(--line)] bg-white shadow-lg py-1 overflow-y-auto"
                  >
                    {matches.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-[var(--ink-soft)]">ไม่พบที่ตรงกับ &quot;{mentionMenu.query}&quot;</p>
                    ) : (
                      matches.map((item, i) => {
                        const Icon = item.type === "user" ? User : item.type === "topic" ? Hash : Building2;
                        return (
                          <button
                            key={`${item.type}-${item.id}`}
                            type="button"
                            onMouseDown={preserveSelection}
                            onClick={() => insertMention(s.id, item)}
                            className={cn(
                              "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                              i === mentionMenu.index ? "bg-[var(--bg-soft)]" : "hover:bg-[var(--bg-soft)]"
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
                            <span className="truncate flex-1">{item.label}</span>
                            {item.sublabel && <span className="text-[11px] text-[var(--ink-soft)] shrink-0">{item.sublabel}</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
        <Button variant="outline" size="sm" onClick={() => onSectionsChange([...sections, newSection()])}>
          <Plus className="h-3.5 w-3.5" />
          เพิ่มหัวข้อย่อย
        </Button>
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.id} className="relative h-20 w-20 rounded-lg overflow-hidden border border-[var(--line)] group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url ?? img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
              <button
                onClick={() => onImagesChange(images.filter((x) => x.id !== img.id))}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`ลบรูป ${img.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {images.length < minImages && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--chart-red)] bg-[var(--chart-red)]/10 rounded-md px-2.5 py-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          ช่วงเวลานี้ต้องแนบรูปอย่างน้อย {minImages} รูปก่อนโพสต์ (แนบแล้ว {images.length})
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || images.length >= 6}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          {busy ? "กำลังแนบรูป..." : "แนบรูป"}
        </Button>
        {/* One album choice for every photo in this post at once — not a
            per-image decision. Only makes sense once something's attached,
            and applies to whatever's attached *right now*; adding more
            photos afterward doesn't retroactively grab this pick, so
            re-tap it if you add photos after choosing. */}
        {images.length > 0 && (
          <AlbumPickerButton
            topicId={topicId}
            imageName="ทุกรูปในโพสต์นี้"
            albumId={images.every((img) => img.albumId === images[0]!.albumId) ? images[0]!.albumId : undefined}
            onChange={(albumId) => onImagesChange(images.map((img) => ({ ...img, albumId })))}
            variant="inline"
          />
        )}
      </div>
    </div>
  );
}
