"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { useTourStore, tourStepsByPage, type TourDemo } from "@/modules/report_task/store/tour-store";
import { ChevronLeft, ChevronRight, MousePointer2, X } from "lucide-react";

const CALLOUT_WIDTH = 320;
const CALLOUT_MARGIN = 20;
const AUTO_ADVANCE_DELAY = 550;

/**
 * Parked in a fixed screen corner rather than anchored next to the
 * spotlighted element. Several steps now genuinely open a dialog, expand the
 * composer, or drop down a mention list right where the spotlight is — a
 * callout glued to that same spot would sit on top of exactly the thing it's
 * explaining. A fixed corner stays clear of all of that.
 */
function calloutStyle(): CSSProperties {
  if (typeof window === "undefined") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  return { bottom: CALLOUT_MARGIN, right: CALLOUT_MARGIN };
}

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * A spotlight product tour — dims the page, cuts a highlighted hole around
 * whatever real element carries the current step's `data-tour` attribute,
 * and plays an animated cursor acting the step out (a click, a drag from one
 * real element to another, or typing into a real text box) before
 * auto-advancing. Every action is genuinely dispatched at the real app (real
 * `.click()`, a real native `drop` event, real typed keystrokes) so whatever
 * the step demos actually appears on screen, not just a cursor pantomime —
 * but every demo undoes itself right after (un-favoriting, closing the
 * dialog it opened, clearing what it typed), so nothing it touches outlives
 * the step.
 */
export function TourOverlay() {
  const active = useTourStore((s) => s.active);
  const tourPage = useTourStore((s) => s.page);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const next = useTourStore((s) => s.next);
  const prev = useTourStore((s) => s.prev);
  const stop = useTourStore((s) => s.stop);
  const pathname = usePathname();
  const steps = tourStepsByPage[tourPage] ?? [];
  const step = steps[stepIndex];
  // Starting a tour on another page navigates there first (see topbar.tsx's
  // startTour) — until that navigation lands, `pathname` still lags behind
  // `tourPage`. Nothing below should locate/play/render until they agree, or
  // it'd briefly search the OLD page for a target that only exists on the new
  // one (or flash a centered callout with no spotlight while it waits).
  const onTourPage = pathname === tourPage;

  const [rect, setRect] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const playedForStep = useRef<number>(-1);
  // The demo-playback effect below reads the target's element/rect through
  // these refs instead of the `rect` state directly — a scroll/resize while
  // a demo is mid-flight updates `rect` (for the live highlight box), and if
  // the playback effect depended on `rect` too, that same update would rerun
  // it, cancel the in-flight animation, and then hit the `playedForStep`
  // guard and never retry — the tour would stall on that step forever.
  const rectRef = useRef<DOMRect | null>(null);
  const targetElRef = useRef<Element | null>(null);

  useEffect(() => {
    // Nothing to locate while inactive — the component's early return below
    // (`if (!active || !step) return null;`) already keeps a stale `rect`
    // from ever rendering, so there's no need to reset it here too.
    if (!active || !step || !onTourPage) return;
    let raf = 0;
    let tries = 0;
    const locate = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        targetElRef.current = el;
        const r = el.getBoundingClientRect();
        rectRef.current = r;
        setRect(r);
      } else if (tries < 90) {
        // The target might not be mounted yet right after navigating to
        // /report-feed (page still loading) — poll a couple seconds before
        // giving up and showing the callout centered with no spotlight.
        tries++;
        raf = requestAnimationFrame(locate);
      } else {
        targetElRef.current = null;
        rectRef.current = null;
        setRect(null);
      }
    };
    locate();

    const onViewportChange = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        rectRef.current = r;
        setRect(r);
      }
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [active, step, pathname, onTourPage]);

  // Plays the cursor demo once per step landing (guarded by `playedForStep`
  // so a resize/scroll re-locating `rect` doesn't replay it), then
  // auto-advances — the "watch it happen, then move on" flow. Fully
  // cancel-safe: clicking Next/Back manually while a demo is mid-flight
  // changes `stepIndex`, which re-runs this effect and its cleanup cancels
  // the in-flight animations/timer first.
  useEffect(() => {
    if (!active || !step || !onTourPage) return;
    if (playedForStep.current === stepIndex) return;
    playedForStep.current = stepIndex;

    let cancelled = false;
    let timer = 0;
    const cursor = cursorRef.current;
    const ghost = ghostRef.current;

    /** Waits for the locate effect (above) to have found this step's target and populated `rectRef` — usually already true by the time this runs, but not guaranteed on the very first paint. */
    function waitForRect(): Promise<DOMRect | null> {
      if (rectRef.current) return Promise.resolve(rectRef.current);
      return new Promise((resolve) => {
        let tries = 0;
        const poll = () => {
          if (rectRef.current || cancelled) return resolve(rectRef.current);
          if (tries++ > 60) return resolve(null);
          requestAnimationFrame(poll);
        };
        poll();
      });
    }

    async function playClick(targetRect: DOMRect) {
      if (!cursor) return;
      const c = center(targetRect);
      cursor.style.opacity = "1";
      const approach = cursor.animate(
        [
          { transform: `translate(${c.x + 70}px, ${c.y - 70}px) scale(1)`, opacity: 0 },
          { transform: `translate(${c.x}px, ${c.y}px) scale(1)`, opacity: 1 },
        ],
        { duration: 550, easing: "cubic-bezier(.22,.8,.32,1)", fill: "forwards" }
      );
      await approach.finished;
      if (cancelled) return;
      const click = cursor.animate(
        [{ transform: `translate(${c.x}px, ${c.y}px) scale(1)` }, { transform: `translate(${c.x}px, ${c.y}px) scale(0.8)` }, { transform: `translate(${c.x}px, ${c.y}px) scale(1)` }],
        { duration: 260, easing: "ease-out" }
      );
      await click.finished;
    }

    /** Polls for a `data-tour` element to exist — used after a real click that expands something (e.g. the composer), since its drop target doesn't exist in the DOM until then. */
    function waitForTourTarget(target: string): Promise<Element | null> {
      return new Promise((resolve) => {
        let tries = 0;
        const poll = () => {
          const el = document.querySelector(`[data-tour="${target}"]`);
          if (el || cancelled) return resolve(el);
          if (tries++ > 60) return resolve(null);
          requestAnimationFrame(poll);
        };
        poll();
      });
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => {
        const id = window.setTimeout(resolve, ms);
        if (cancelled) { clearTimeout(id); resolve(); }
      });
    }

    /** Waits for a WAAPI animation to finish, but never longer than `timeoutMs` — its `.finished` promise can end up permanently unsettled (neither resolving nor rejecting) after enough prior steps' animations have been created and cancelled in the same session, and one stuck await here would freeze the whole tour on whatever step hit it. */
    function settleAnimation(anim: Animation, timeoutMs: number): Promise<void> {
      return Promise.race([anim.finished.then(() => {}).catch(() => {}), sleep(timeoutMs)]);
    }

    /** Real click, wait so the change is visible (e.g. the star turning gold), then click again (or `revertTarget`, for a two-button toggle like a tab pair) to put it back. */
    async function playToggleClick(targetRect: DOMRect, demo: Extract<TourDemo, { type: "toggle-click" }>) {
      const el = targetElRef.current as HTMLElement | null;
      await playClick(targetRect);
      if (cancelled || !el) return;
      el.click();
      await sleep(1000);
      if (cancelled) return;
      // Re-query rather than reusing `el` — favoriting can move the row into
      // a new "รายการโปรด" section, detaching the original element from the
      // document, so a second click on the stale reference would no-op.
      const revertSelector = demo.revertTarget ?? step!.target;
      const freshEl = document.querySelector(`[data-tour="${revertSelector}"]`) as HTMLElement | null;
      freshEl?.click();
    }

    /** Real click to open something, wait so it's visible, then a real click on `closeTarget` to close it back up. */
    async function playClickAndClose(targetRect: DOMRect, demo: Extract<TourDemo, { type: "click-and-close" }>) {
      const el = targetElRef.current as HTMLElement | null;
      await playClick(targetRect);
      if (cancelled || !el) return;
      el.click();
      const closeEl = await waitForTourTarget(demo.closeTarget);
      if (cancelled) return;
      await sleep(1400);
      if (cancelled) return;
      (closeEl as HTMLElement | null)?.click();
    }

    function fireMouse(target: EventTarget, type: string, x: number, y: number, buttons = 0) {
      // `buttons` (the bitmask of *currently held* buttons, distinct from
      // `button`, which only names the one that triggered this specific
      // event) has to be set to 1 on the down/move events of a drag —
      // FullCalendar's interaction plugin reads it to confirm the mouse
      // button is still held on each move, and silently drops the whole
      // gesture otherwise.
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons }));
    }

    /** Fires a real mousedown → mousemove(s) → mouseup sequence across day cells `startIndex..endIndex` (either direction), entirely synchronously — FullCalendar's own drag-to-select silently drops the gesture if even a few milliseconds pass between these events (an `await`, a `setTimeout`), so nothing here can be paced against the visual cursor animation. Re-queries the cell list itself right before firing rather than accepting one captured earlier — an already-fired drag (e.g. the warm-up below) can leave FullCalendar having quietly swapped in fresh cell elements, and firing at stale ones from an old snapshot goes nowhere. */
    function fireCellDrag(startIndex: number, endIndex: number) {
      const dayCells = Array.from(document.querySelectorAll(".fc-daygrid-day"));
      // index ทั้งคู่มาจาก indexOf/clamp กับ dayCells ชุดเดียวกัน จึงอยู่ในช่วงเสมอ
      const startEl = dayCells[startIndex]!;
      const endEl = dayCells[endIndex]!;
      const startPoint = center(startEl.getBoundingClientRect());
      const endPoint = center(endEl.getBoundingClientRect());
      const step = endIndex >= startIndex ? 1 : -1;
      fireMouse(startEl, "mousedown", startPoint.x, startPoint.y, 1);
      for (let i = startIndex + step; i !== endIndex + step; i += step) {
        const r = center(dayCells[i]!.getBoundingClientRect());
        fireMouse(dayCells[i]!, "mousemove", r.x, r.y, 1);
      }
      // Fired at `document`, not `endEl` — FullCalendar's interaction plugin
      // finalizes a selection through a document-level pointerup listener it
      // attaches for the duration of the drag; a mouseup dispatched on the
      // cell itself doesn't reach it.
      fireMouse(document, "mouseup", endPoint.x, endPoint.y, 0);
    }

    /**
     * Drags across real calendar day cells to demo FullCalendar's own
     * drag-to-select. The one thing that actually matters: both cells have
     * to be genuinely on screen — a cell scrolled out of the viewport never
     * registers a hit, synthetic event or not, same as a real user couldn't
     * drag to a spot they can't see either. Everything else (the `buttons`
     * bitmask on every down/move, mouseup fired at `document`, steering
     * clear of trailing "other month" cells and any 1-day span) just makes
     * the event sequence itself a faithful match for a real drag. Nothing
     * is written anywhere — a selected range only ever opens a read-only
     * summary.
     */
    async function playDragSelect(_fromRect: DOMRect, demo: Extract<TourDemo, { type: "drag-select" }>) {
      if (!cursor) return;
      // A brief settle beat before touching the grid at all — landing on
      // this step right after an earlier one that changed what the
      // calendar renders (the scope toggle swapping which tasks show, the
      // view switcher rebuilding the whole grid) can still be mid-reflow;
      // re-querying fresh here (not reusing `targetElRef.current`, in case
      // that re-render already replaced it) avoids racing that settle.
      await sleep(300);
      if (cancelled) return;
      const startEl = document.querySelector(`[data-tour="${step!.target}"]`);
      if (!startEl) return;
      const dayCells = Array.from(document.querySelectorAll(".fc-daygrid-day"));
      const startIndex = dayCells.indexOf(startEl as Element);
      if (startIndex === -1) return;
      let endIndex = Math.min(startIndex + demo.toDateOffsetDays, dayCells.length - 1);
      while (endIndex > startIndex && dayCells[endIndex]!.classList.contains("fc-day-other")) endIndex--;
      if (endIndex - startIndex < 2) {
        endIndex = Math.max(startIndex - demo.toDateOffsetDays, 0);
        while (endIndex < startIndex && dayCells[endIndex]!.classList.contains("fc-day-other")) endIndex++;
      }
      if (Math.abs(endIndex - startIndex) < 2) return;

      dayCells[endIndex]!.scrollIntoView({ block: "center", behavior: "instant" });
      await sleep(150);
      if (cancelled) return;

      // Re-query and re-measure both ends fresh after the scroll jump —
      // positions moved, and `fromRect` (captured before this step's own
      // scroll) is now stale.
      const freshDayCells = Array.from(document.querySelectorAll(".fc-daygrid-day"));
      const freshStartEl = freshDayCells[startIndex];
      const freshEndEl = freshDayCells[endIndex];
      if (!freshStartEl || !freshEndEl) return;
      const from = center(freshStartEl.getBoundingClientRect());
      const to = center(freshEndEl.getBoundingClientRect());

      cursor.style.opacity = "1";
      const approach = cursor.animate(
        [
          { transform: `translate(${from.x + 70}px, ${from.y - 70}px) scale(1)`, opacity: 0 },
          { transform: `translate(${from.x}px, ${from.y}px) scale(1)`, opacity: 1 },
        ],
        { duration: 500, easing: "cubic-bezier(.22,.8,.32,1)", fill: "forwards" }
      );
      // `.finished` here can end up permanently unsettled after enough
      // prior steps — see `settleAnimation`'s own comment — so this waits
      // for it with a timeout rather than an unguarded `await`.
      await settleAnimation(approach, 700);
      if (cancelled) return;

      // This overlay's own full-screen backdrop, sitting above the whole
      // page at z-100, quietly breaks FullCalendar's own hit-tracking for
      // the drag — true even with the backdrop's `pointer-events` left
      // alone, so it isn't about intercepting the events themselves. Hiding
      // the whole overlay for the synchronous instant `fireCellDrag` runs in
      // (no `await` in between) and restoring it right after happens inside
      // one paint frame — nothing visibly flashes.
      const root = rootRef.current;
      if (root) root.style.display = "none";
      fireCellDrag(startIndex, endIndex);
      if (root) root.style.display = "";

      const dragAnim = cursor.animate(
        [
          { transform: `translate(${from.x}px, ${from.y}px) scale(0.9)` },
          { transform: `translate(${to.x}px, ${to.y}px) scale(0.9)` },
        ],
        { duration: 800, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" }
      );
      await settleAnimation(dragAnim, 1000);
      if (cancelled) return;

      const closeEl = await waitForTourTarget(demo.closeTarget);
      if (cancelled) return;
      await sleep(1600);
      if (cancelled) return;
      (closeEl as HTMLElement | null)?.click();
    }

    /** Real click to reveal a text box, types real text into it, waits so the result (e.g. a dropdown or a filtered list) is visible, then reverts via `revertTarget`. */
    async function playClickAndType(targetRect: DOMRect, demo: Extract<TourDemo, { type: "click-and-type" }>) {
      const el = targetElRef.current as HTMLElement | null;
      await playClick(targetRect);
      if (cancelled || !el) return;
      el.click();
      const intoEl = await waitForTourTarget(demo.intoTarget);
      if (cancelled || !intoEl) return;
      if (intoEl instanceof HTMLInputElement || intoEl instanceof HTMLTextAreaElement) {
        // A plain <input>/<textarea> isn't part of the DOM's text-node tree
        // the way contentEditable is, so Range/Selection + execCommand don't
        // reach it — set the value through React's own native setter (so its
        // internal value-tracker doesn't swallow the change) and dispatch a
        // real `input` event, exactly what a keystroke would produce.
        const proto = intoEl instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        intoEl.focus();
        setter?.call(intoEl, intoEl.value + demo.text);
        intoEl.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        // contentEditable — this fires a real native `input` event too (via
        // execCommand), which is what the editor's own @mention detection
        // and similar onInput handlers run off.
        const textEl = intoEl as HTMLElement;
        textEl.focus();
        const range = document.createRange();
        range.selectNodeContents(textEl);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand("insertText", false, demo.text);
      }
      await sleep(1600);
      if (cancelled) return;
      if (demo.revertTarget) {
        const revertEl = document.querySelector(`[data-tour="${demo.revertTarget}"]`) as HTMLElement | null;
        revertEl?.click();
      }
    }

    async function playDrag(fromRect: DOMRect, demo: Extract<TourDemo, { type: "drag" }>) {
      if (!cursor || !ghost) return;

      // Some drop targets only exist once something else is genuinely
      // clicked first (the composer's text box isn't in the DOM until the
      // "เริ่มการสนทนาใหม่" button expands it) — a real click, not just a
      // cursor animation over it, since it's an inert, reversible bit of UI
      // state (nothing gets written or posted).
      if (demo.expandFirst) {
        const expandEl = document.querySelector(`[data-tour="${demo.expandFirst}"]`);
        if (expandEl) {
          await playClick(expandEl.getBoundingClientRect());
          if (cancelled) return;
          (expandEl as HTMLElement).click();
          await waitForTourTarget(demo.toTarget);
          if (cancelled) return;
        }
      }

      const toEl = document.querySelector(`[data-tour="${demo.toTarget}"]`);
      if (!toEl) return;
      const from = center(fromRect);
      const to = center(toEl.getBoundingClientRect());

      cursor.style.opacity = "1";
      const approach = cursor.animate(
        [
          { transform: `translate(${from.x + 70}px, ${from.y - 70}px) scale(1)`, opacity: 0 },
          { transform: `translate(${from.x}px, ${from.y}px) scale(1)`, opacity: 1 },
        ],
        { duration: 500, easing: "cubic-bezier(.22,.8,.32,1)", fill: "forwards" }
      );
      await approach.finished;
      if (cancelled) return;

      // "Grab" — cursor shrinks slightly and the ghost chip appears under it.
      ghost.style.opacity = "1";
      ghost.style.transform = `translate(${from.x}px, ${from.y}px) scale(1)`;
      const grab = cursor.animate([{ transform: `translate(${from.x}px, ${from.y}px) scale(1)` }, { transform: `translate(${from.x}px, ${from.y}px) scale(0.85)` }], {
        duration: 180,
        fill: "forwards",
      });
      await grab.finished;
      if (cancelled) return;

      const dragCursor = cursor.animate(
        [
          { transform: `translate(${from.x}px, ${from.y}px) scale(0.85)` },
          { transform: `translate(${to.x}px, ${to.y}px) scale(0.85)` },
        ],
        { duration: 750, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" }
      );
      ghost.animate(
        [
          { transform: `translate(${from.x}px, ${from.y}px) scale(1)`, opacity: 1 },
          { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1 },
        ],
        { duration: 750, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" }
      );
      await dragCursor.finished;
      if (cancelled) return;

      // "Drop" — ghost pops and fades, cursor bounces back to full size.
      ghost.animate([{ transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1 }, { transform: `translate(${to.x}px, ${to.y}px) scale(1.15)`, opacity: 0 }], {
        duration: 320,
        easing: "ease-out",
        fill: "forwards",
      });
      const drop = cursor.animate(
        [{ transform: `translate(${to.x}px, ${to.y}px) scale(0.85)` }, { transform: `translate(${to.x}px, ${to.y}px) scale(1)` }],
        { duration: 220, easing: "ease-out" }
      );
      await drop.finished;
      if (cancelled) return;

      // Actually drop the mention — a real native `drop` event carrying the
      // same MIME payload topic-sidebar.tsx's onDragStart sets, dispatched
      // at the exact point the ghost landed. This runs through the editor's
      // real onDrop handler (handleMentionDrop in report-post-fields.tsx),
      // so a genuine mention chip appears in the text, not just a ghost that
      // vanishes — but it's still fully reversible, since `collapseAfter`
      // right below calls the composer's real "ยกเลิก" button, which resets
      // its draft (including this chip) back to blank.
      const fromEl = targetElRef.current;
      const topicId = fromEl?.getAttribute("data-topic-id");
      const topicName = fromEl?.getAttribute("data-topic-name");
      if (topicId && topicName) {
        const dt = new DataTransfer();
        dt.setData("application/x-mention-topic", JSON.stringify({ id: topicId, name: topicName }));
        const dropEvent = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: to.x, clientY: to.y });
        Object.defineProperty(dropEvent, "dataTransfer", { value: dt });
        toEl.dispatchEvent(dropEvent);
        // Let the chip actually render and sit on screen for a beat — collapsing
        // right away would race the composer's own reset() against the drop's
        // state update in the same tick and the chip would never visibly appear.
        await new Promise((resolve) => setTimeout(resolve, 900));
        if (cancelled) return;
      }

      // Leave the page back the way this step found it — a real click on
      // whatever collapses the thing `expandFirst` opened — so later steps
      // (e.g. the composer-trigger step) still find their own target.
      if (demo.collapseAfter) {
        const collapseEl = document.querySelector(`[data-tour="${demo.collapseAfter}"]`) as HTMLElement | null;
        collapseEl?.click();
      }
    }

    async function run() {
      const startRect = await waitForRect();
      if (cancelled || !startRect) return;
      try {
        const demo = step!.demo;
        if (demo.type === "toggle-click") await playToggleClick(startRect, demo);
        else if (demo.type === "click-and-close") await playClickAndClose(startRect, demo);
        else if (demo.type === "click-and-type") await playClickAndType(startRect, demo);
        else if (demo.type === "drag-select") await playDragSelect(startRect, demo);
        else await playDrag(startRect, demo);
      } catch {
        // `.finished` rejects with AbortError when the cleanup below cancels
        // an in-flight animation (e.g. the user clicked Next/Back or closed
        // the tour before the demo finished) — expected flow control, not a
        // real failure.
        return;
      }
      if (cancelled || !cursor) return;
      cursor.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" });
      timer = window.setTimeout(() => {
        if (!cancelled) next();
      }, AUTO_ADVANCE_DELAY);
    }
    run();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cursor?.getAnimations().forEach((a) => a.cancel());
      ghost?.getAnimations().forEach((a) => a.cancel());
      if (cursor) cursor.style.opacity = "0";
      if (ghost) ghost.style.opacity = "0";
    };
  }, [active, step, stepIndex, next, onTourPage]);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") stop();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, next, prev, stop]);

  if (!active || !step || !onTourPage) return null;

  return (
    <div ref={rootRef} className="fixed inset-0 z-[100]">
      <button
        className="absolute inset-0 bg-black/10 cursor-default"
        onClick={stop}
        aria-label="ปิดทัวร์แนะนำ"
        tabIndex={-1}
      />
      {rect && (
        <div
          className="absolute rounded-lg ring-2 ring-[var(--brand-green)] pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      )}

      {/* Animated demo cursor + drag-ghost — positioned at 0,0 and moved
          entirely via Web Animations transforms set in the effect above, so
          React never fights the in-flight animation with a re-render. */}
      <div
        ref={cursorRef}
        className="absolute top-0 left-0 -ml-1 -mt-1 pointer-events-none z-[8] opacity-0 text-[var(--ink)] drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
      >
        <MousePointer2 className="h-6 w-6 fill-white" />
      </div>
      <div
        ref={ghostRef}
        className="absolute top-0 left-0 pointer-events-none z-[7] opacity-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand-green)] text-[var(--ink)] text-[11px] font-semibold px-2.5 py-1 shadow-lg whitespace-nowrap"
      >
        # ห้องนี้
      </div>

      <div
        className="absolute rounded-xl bg-white shadow-2xl p-4 space-y-2.5 transition-all duration-300 ease-out"
        style={{ width: CALLOUT_WIDTH, ...calloutStyle() }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[var(--ink-soft)] tabular-nums">
            ขั้นตอน {stepIndex + 1}/{steps.length}
          </span>
          <button onClick={stop} aria-label="ปิดทัวร์" className="text-[var(--ink-soft)] hover:text-[var(--ink)] rounded p-0.5 hover:bg-[var(--bg-soft)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm font-semibold">{step.title}</p>
        <p className="text-xs text-[var(--ink-soft)] leading-relaxed">{step.description}</p>
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={prev}
            disabled={stepIndex === 0}
            className="flex items-center gap-1 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-30 disabled:hover:text-[var(--ink-soft)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> ก่อนหน้า
          </button>
          <button
            onClick={next}
            className="flex items-center gap-1 text-xs font-semibold text-[var(--ink)] hover:text-white bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] rounded-full px-3 py-1.5 transition-colors"
          >
            {stepIndex === steps.length - 1 ? "เสร็จสิ้น" : "ถัดไป"} <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
