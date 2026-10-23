import type { MentionType } from "@/modules/report_task/lib/report-feed-rich-text";

/** หนึ่งตัวเลือกในเมนู @ ของช่องพิมพ์ในห้องรีพอต (คน · แผนก · ทุกคนในห้อง · CEO) */
export interface MentionItem {
  type: MentionType;
  id: string;
  label: string;
  sublabel?: string;
}

/** Walks up from `el` to find the nearest scrolling ancestor's viewport
 * bounds — the mention menu opens above or below the caret depending on
 * which direction actually has room within *that* box, not the window
 * (the editors sit inside a card inside a scrollable feed). */
export function nearestScrollableBounds(el: HTMLElement): { top: number; bottom: number } {
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

/** Looks for `@query` immediately before the caret in the current text node
 * and returns its position — null when the caret isn't inside `el`, isn't in
 * a text node, or there's no unfinished `@word` right before it. */
export function detectMentionTrigger(el: HTMLElement): { query: string; rect: DOMRect; containerTop: number; containerBottom: number } | null {
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

/** แทน `@คำค้น` หน้าเคอร์เซอร์ด้วยชิปแท็ก (contenteditable=false) + เว้นวรรค แล้ววางเคอร์เซอร์ต่อท้าย — คืน false ถ้าวางไม่ได้ */
export function insertMentionChip(el: HTMLElement, item: MentionItem): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return false;
  const nodeText = node.textContent ?? "";
  const before = nodeText.slice(0, range.startOffset);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return false;
  const afterCaret = nodeText.slice(range.startOffset);
  const parent = node.parentNode;
  if (!parent) return false;

  const chip = document.createElement("span");
  chip.className = "mention-chip inline-flex items-center rounded bg-[#5865f2]/15 text-[#4752c4] px-1 font-medium transition-colors hover:bg-[#5865f2] hover:text-white";
  chip.contentEditable = "false";
  chip.setAttribute("data-mention-type", item.type);
  chip.setAttribute("data-mention-id", item.id);
  chip.textContent = `@${item.label}`;

  const afterNode = document.createTextNode(afterCaret);
  const spaceNode = document.createTextNode(" ");
  parent.replaceChild(afterNode, node);
  parent.insertBefore(document.createTextNode(nodeText.slice(0, atIndex)), afterNode);
  parent.insertBefore(chip, afterNode);
  parent.insertBefore(spaceNode, afterNode);

  const newRange = document.createRange();
  newRange.setStart(spaceNode, spaceNode.length);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  return true;
}
