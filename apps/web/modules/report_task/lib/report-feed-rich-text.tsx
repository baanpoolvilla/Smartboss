import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/modules/report_task/lib/utils";
import { Square, SquareCheckBig } from "lucide-react";

export type MentionType = "user" | "topic" | "dept";

/** Wraps a mention target so `@สมชาย ศรีสุข`/`@ทีมพัฒนา`/`@วิศวกรรม` round-trip through storage as `@[label](type:id)` — the label is frozen at post time (renaming the target later doesn't rewrite old mentions), the id is what a topic mention actually navigates to. */
export function mentionMarker(type: MentionType, id: string, label: string): string {
  return `@[${label}](${type}:${id})`;
}

const MENTION_ONLY_PATTERN = /@\[([^\]]+)\]\((user|topic|dept):([^)]+)\)/g;

/** Every distinct id of the given mention type found in a chunk of stored text — e.g. who to notify when a post/reply @mentions people. */
export function extractMentionedIds(text: string, type: MentionType): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(MENTION_ONLY_PATTERN)) {
    if (m[2] === type) ids.add(m[3]!);
  }
  return [...ids];
}

/** Wrap/insert markers written by the composer's formatting buttons. */
export const richTextMarkers = {
  bold: "**",
  italic: "*",
  underline: "__",
  code: "`",
} as const;

export const HORIZONTAL_RULE_LINE = "---";

// The bare-URL branch must come last — it has no closing delimiter to stop
// at, so it only gets a turn once the delimited branches have had first pick.
// The mention branch comes first — its label can itself contain characters
// like "(" that would otherwise confuse the later branches.
const RICH_TEXT_PATTERN =
  /@\[([^\]]+)\]\((user|topic|dept):([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|`(.+?)`|(https?:\/\/[^\s<>"']+)/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converts stored `**bold**`/`*italic*`/`__underline__`/`` `code` ``/`@[label](type:id)` marker text into the WYSIWYG editor's live HTML. */
export function bulletsTextToHtml(text: string): string {
  const html = text
    .split("\n")
    .map((line) =>
      escapeHtml(line).replace(RICH_TEXT_PATTERN, (whole, mLabel, mType, mId, b, i, u, c) => {
        // A bare URL match falls through to here too — left as plain text in
        // the editor (not a live <a>), since linkifying it would make the
        // URL uneditable as text mid-edit.
        if (mLabel !== undefined) {
          return `<span class="mention-chip" contenteditable="false" data-mention-type="${mType}" data-mention-id="${mId}">@${mLabel}</span>`;
        }
        if (b !== undefined) return `<b>${b}</b>`;
        if (i !== undefined) return `<i>${i}</i>`;
        if (u !== undefined) return `<u>${u}</u>`;
        if (c !== undefined) return `<code>${c}</code>`;
        return whole;
      })
    )
    .join("<br>");
  // A completely empty contentEditable has no node to anchor a caret to —
  // clicking into it doesn't reliably place a selection in Chromium. A lone
  // <br> (what the browser itself leaves behind after you delete all text)
  // fixes that.
  return html === "" ? "<br>" : html;
}

interface FormatFlags {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  code: boolean;
}

function applyFormatMarkers(text: string, flags: FormatFlags): string {
  let t = text;
  if (flags.code) t = `\`${t}\``;
  if (flags.bold) t = `**${t}**`;
  if (flags.italic) t = `*${t}*`;
  if (flags.underline) t = `__${t}__`;
  return t;
}

/**
 * Walks the whole tree (not just top-level children) tracking which
 * bold/italic/underline/code ancestors are active, and starts a new line at
 * every <br> regardless of nesting depth. A plain top-level-children split
 * breaks as soon as a <br> ends up nested — which happens whenever you
 * select text spanning multiple lines and click Bold: execCommand wraps the
 * whole selection, <br> included, in a single <b>.
 */
function collectLines(el: HTMLElement): string[] {
  const lines: string[] = [];
  let current = "";

  function walk(node: Node, flags: FormatFlags, isRoot = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) current += text.trim() ? applyFormatMarkers(text, flags) : text;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const elNode = node as HTMLElement;
    if (elNode.tagName === "BR") {
      lines.push(current);
      current = "";
      return;
    }
    if (elNode.classList.contains("mention-chip")) {
      const mType = elNode.getAttribute("data-mention-type");
      const mId = elNode.getAttribute("data-mention-id");
      const label = (elNode.textContent ?? "").replace(/^@/, "");
      if (mType && mId) current += mentionMarker(mType as MentionType, mId, label);
      return;
    }
    // Dragging a browser tab (or pasting a rich link from a doc/chat app)
    // inserts a real <a href> — the browser's own default paste behavior,
    // never touched here since nothing calls preventDefault on paste. Falling
    // through to the generic branch below would recurse into its text and
    // keep only the *label* ("1,900+ n8n Automations... - Google Drive"),
    // silently dropping the href — which is exactly what made a pasted link
    // render as inert text instead of something clickable. Keeping the href
    // itself as a bare URL here is what renderRichBulletText's own
    // bare-http(s) rule already knows how to linkify, so this needs no
    // special marker of its own.
    if (elNode.tagName === "A") {
      const href = elNode.getAttribute("href");
      if (href) {
        current += href;
        return;
      }
    }
    // Typing here never produces DIV/P/LI — Enter is caught and manually
    // turned into a plain <br> by every composer's own keydown handler. But
    // pasting multi-line content (another chat, a doc, a spreadsheet) is the
    // browser's own paste normalization, never ours to intercept, and Chrome
    // wraps *each pasted line* in its own <div> (or <li>/<p> for a pasted
    // list) instead of joining them with <br>. Recursing into one of these
    // through the generic branch below — the only thing this function used
    // to do — ran every pasted line into the last one with no separator at
    // all, which is what turned a pasted list into one garbled row instead
    // of several. Treating a block's end as a line break, same as <br>,
    // fixes that; guarded to skip the outer contentEditable root itself,
    // which is a <div> too but isn't a "line" of its own.
    if (!isRoot && (elNode.tagName === "DIV" || elNode.tagName === "P" || elNode.tagName === "LI")) {
      // A pasted <li> carries no visible marker of its own (that's the
      // parent <ul>/<ol>'s job) — stamp "• " back on so the list survives
      // the round trip as *something* recognizable rather than becoming
      // indistinguishable plain lines.
      const isListItem = elNode.tagName === "LI" && !current.trim();
      if (isListItem) current += BULLET_MARKER;
      const nextFlags: FormatFlags = {
        bold: flags.bold || false,
        italic: flags.italic || false,
        underline: flags.underline || false,
        code: flags.code || false,
      };
      for (const child of Array.from(elNode.childNodes)) walk(child, nextFlags);
      lines.push(current);
      current = "";
      return;
    }
    const nextFlags: FormatFlags = {
      bold: flags.bold || elNode.tagName === "B" || elNode.tagName === "STRONG",
      italic: flags.italic || elNode.tagName === "I" || elNode.tagName === "EM",
      underline: flags.underline || elNode.tagName === "U",
      code: flags.code || elNode.tagName === "CODE",
    };
    for (const child of Array.from(elNode.childNodes)) walk(child, nextFlags);
  }

  walk(el, { bold: false, italic: false, underline: false, code: false }, true);
  lines.push(current);
  return lines;
}

/** Reads the WYSIWYG editor's live DOM back into marker text, splitting lines at each `<br>`. */
export function htmlEditorToBulletsText(el: HTMLElement): string {
  // Mirror of the lone-<br> placeholder bulletsTextToHtml("") produces.
  if (el.childNodes.length === 1 && el.childNodes[0]!.nodeType === Node.ELEMENT_NODE && (el.childNodes[0]! as HTMLElement).tagName === "BR") {
    return "";
  }
  return collectLines(el).join("\n");
}

const mentionChipClass = "inline-flex items-center rounded bg-[var(--accent)] text-[var(--brand-green-dark)] px-1 font-medium";

/** Renders **bold**, *italic*, __underline__, `code`, bare http(s) links, and `@[label](type:id)` mentions written via the bullet toolbar. A topic mention links straight to that room; person/department mentions are just a styled highlight — nothing to navigate to. */
export function renderRichBulletText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(RICH_TEXT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    if (match[1] !== undefined) {
      const [, label, mType, mId] = match;
      nodes.push(
        mType === "topic" ? (
          <Link key={key++} href={`/report-feed?topic=${mId}`} onClick={(e) => e.stopPropagation()} className={cn(mentionChipClass, "hover:underline")}>
            @{label}
          </Link>
        ) : (
          <span key={key++} className={mentionChipClass}>
            @{label}
          </span>
        )
      );
    } else if (match[4] !== undefined) nodes.push(<strong key={key++}>{match[4]}</strong>);
    else if (match[5] !== undefined) nodes.push(<em key={key++}>{match[5]}</em>);
    else if (match[6] !== undefined) nodes.push(<u key={key++}>{match[6]}</u>);
    else if (match[7] !== undefined)
      nodes.push(
        <code key={key++} className="bg-[var(--bg-soft)] ring-1 ring-inset ring-[var(--line)] rounded px-1 py-0.5 text-[12px] font-mono">
          {match[7]}
        </code>
      );
    else if (match[8] !== undefined)
      nodes.push(
        <a
          key={key++}
          href={match[8]}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--brand-green-dark)] hover:underline break-all"
        >
          {match[8]}
        </a>
      );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const TABLE_ROW_PATTERN = /^\|(.+)\|$/;
const NUMBERED_LINE_PATTERN = /^\d+\.\s+/;
/** Capturing version, shared with the composer's Enter-to-continue-list logic. */
export const NUMBERED_LINE_PREFIX = /^(\d+)\.\s+/;
/** Explicit bullet marker the toolbar's "bulleted list" button writes, shared with the composer. */
export const BULLET_LINE_PREFIX = /^•\s+/;
// A non-breaking space, not a plain " " — HTML collapses a trailing plain
// space at a node boundary (execCommand and Range text nodes both hit this),
// which would silently break the "N. "/"• " pattern match on read-back.
export const BULLET_MARKER = "• ";
export function numberedMarker(n: number): string {
  return `${n}.` + String.fromCharCode(160);
}

// Checklist state is stored as the literal box glyph at the start of the
// line — toggling just swaps one marker for the other, no separate
// "checked" field to keep in sync with the text.
export const CHECKLIST_UNCHECKED = "☐ ";
export const CHECKLIST_CHECKED = "☑ ";
export const CHECKLIST_LINE_PREFIX = /^(☐|☑)\s+/;
export function isChecklistLine(line: string): boolean {
  return CHECKLIST_LINE_PREFIX.test(line.trim());
}
export function isChecklistChecked(line: string): boolean {
  return line.trim().startsWith(CHECKLIST_CHECKED.trim());
}
function stripChecklistPrefix(line: string): string {
  return line.trim().replace(CHECKLIST_LINE_PREFIX, "");
}

function isTableRow(line: string): boolean {
  return TABLE_ROW_PATTERN.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
}

function isNumberedLine(line: string): boolean {
  return NUMBERED_LINE_PATTERN.test(line.trim());
}

/** The number to use for a new "N. " line, based on the numbered line (if any) right before the cursor. */
export function nextListNumber(text: string, cursorPos: number): number {
  const lines = text.slice(0, cursorPos).split("\n");
  let i = lines.length - 1;
  // Cursor sits on a blank line (e.g. right after a newline) — look at the line above it instead.
  if (lines[i]!.trim() === "" && i > 0) i--;
  const match = lines[i]?.match(NUMBERED_LINE_PREFIX);
  return match ? parseInt(match[1]!, 10) + 1 : 1;
}

function stripNumberedPrefix(line: string): string {
  return line.trim().replace(NUMBERED_LINE_PATTERN, "");
}

function stripBulletPrefix(line: string): string {
  return line.trim().replace(BULLET_LINE_PREFIX, "");
}

/**
 * Splits a section's bullet lines into bullet-list / numbered-list /
 * horizontal-rule / table runs — a "---" line, consecutive "N. " lines, or
 * consecutive "| a | b |" lines typed via the toolbar's insert buttons —
 * and renders each as the matching block.
 */
export function renderSectionBullets(bullets: string[], onToggleChecklist?: (bulletIndex: number) => void): ReactNode {
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < bullets.length) {
    const line = bullets[i]!;

    if (line.trim() === HORIZONTAL_RULE_LINE) {
      blocks.push(<hr key={key++} className="border-[var(--line)] my-1.5" />);
      i++;
      continue;
    }

    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < bullets.length && isTableRow(bullets[i]!)) {
        rows.push(parseTableRow(bullets[i]!));
        i++;
      }
      const [header = [], ...body] = rows;
      blocks.push(
        <div key={key++} className="overflow-x-auto my-1">
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                {header.map((cell, ci) => (
                  <th key={ci} className="border border-[var(--line)] bg-[var(--bg-soft)] px-2 py-1 text-left font-semibold whitespace-nowrap">
                    {renderRichBulletText(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            {body.length > 0 && (
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-[var(--line)] px-2 py-1 whitespace-nowrap">
                        {renderRichBulletText(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      );
      continue;
    }

    if (isNumberedLine(line)) {
      const items: string[] = [];
      while (i < bullets.length && isNumberedLine(bullets[i]!)) {
        items.push(stripNumberedPrefix(bullets[i]!));
        i++;
      }
      blocks.push(
        <ol key={key++} className="space-y-0.5">
          {items.map((b, bi) => (
            <li key={bi} className="text-base text-[var(--ink)] flex items-start gap-1.5">
              <span className="text-[var(--ink)] tabular-nums shrink-0">{bi + 1}.</span>
              <span>{renderRichBulletText(b)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    if (isChecklistLine(line)) {
      const items: { text: string; checked: boolean; index: number }[] = [];
      while (i < bullets.length && isChecklistLine(bullets[i]!)) {
        items.push({ text: stripChecklistPrefix(bullets[i]!), checked: isChecklistChecked(bullets[i]!), index: i });
        i++;
      }
      blocks.push(
        <div key={key++} className="space-y-1">
          {items.map((item) => (
            <button
              key={item.index}
              type="button"
              onClick={() => onToggleChecklist?.(item.index)}
              disabled={!onToggleChecklist}
              className="w-full flex items-start gap-1.5 text-left disabled:cursor-default"
            >
              {item.checked ? (
                <SquareCheckBig className="h-4 w-4 mt-0.5 shrink-0 text-[var(--brand-green-dark)]" />
              ) : (
                <Square className="h-4 w-4 mt-0.5 shrink-0 text-[var(--ink-soft)]" />
              )}
              <span className={cn("text-base", item.checked ? "text-[var(--ink-soft)] line-through" : "text-[var(--ink)]")}>
                {renderRichBulletText(item.text)}
              </span>
            </button>
          ))}
        </div>
      );
      continue;
    }

    const run: string[] = [];
    while (
      i < bullets.length &&
      bullets[i]!.trim() !== HORIZONTAL_RULE_LINE &&
      !isTableRow(bullets[i]!) &&
      !isNumberedLine(bullets[i]!) &&
      !isChecklistLine(bullets[i]!)
    ) {
      run.push(bullets[i]!);
      i++;
    }
    // Only lines with an explicit "• " marker get the bullet dot — a plain
    // line typed without clicking the bulleted-list button is just text.
    blocks.push(
      <div key={key++} className="space-y-0.5">
        {run.map((b, bi) => {
          const bulleted = BULLET_LINE_PREFIX.test(b.trim());
          return (
            <p key={bi} className="text-base text-[var(--ink)] flex items-start gap-1.5">
              {bulleted && <span className="text-[var(--ink)] mt-0.5 shrink-0">•</span>}
              <span>{renderRichBulletText(bulleted ? stripBulletPrefix(b) : b)}</span>
            </p>
          );
        })}
      </div>
    );
  }

  return <>{blocks}</>;
}
