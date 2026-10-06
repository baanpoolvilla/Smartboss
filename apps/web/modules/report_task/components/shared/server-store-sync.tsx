"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { StoreApi, UseBoundStore } from "zustand";
import type { StoreKey } from "@/modules/report_task/lib/db/store-registry";
import { isServerSyncHeld } from "@/modules/report_task/lib/sync-pause";
import { realtimeStatus, subscribeRealtime } from "@/lib/realtime-client";
import { registerSyncProbe } from "@/lib/unsaved-work";
import { mergeThreeWay } from "./store-merge";

type AnyStore<T> = UseBoundStore<StoreApi<T>>;

/** Default for `pollMs` when a caller doesn't pass one — matches the old
 * always-4s behavior for anything not yet tuned. */
const DEFAULT_POLL_MS = 4000;

/** While the realtime pipe is connected, saves arrive as signals — the poll is
 * only a safety net for a missed one, so it backs off to this. */
const REALTIME_FALLBACK_MS = 60_000;

/** Same value per field by reference (one level deep) — a cheap "definitely
 * unchanged" check for immutable store slices before falling back to a full
 * serialized compare. */
function sameFields(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => Object.is(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Generic server-backed replacement for zustand's `persist` + localStorage,
 * for state that's shared across teammates (not per-user view prefs — those
 * stay in localStorage). Loads `select(state)` from `/api/report-task/store/{apiKey}` on
 * mount, then debounce-writes it back after every change.
 *
 * Collaboration model (so several people can edit the same board at once):
 *   - a light poll pulls in other people's saves while you're just viewing, so
 *     everyone converges on the same state without anyone having to refresh;
 *   - if two saves race and the server returns 409, we DON'T pop a warning or
 *     drop the edit — we fetch their latest, 3-way merge our own changes on top
 *     (per item id, so different posts/topics never clobber each other), and
 *     retry. Everybody's edits survive and there's no interruption.
 */
export function ServerStoreSync<T, S>({
  apiKey,
  store,
  select,
  apply,
  /** How often (ms) each open tab checks whether a teammate saved, so other
   * people's edits show up on their own rather than only when you try to
   * save. Every mounted ServerStoreSync polls independently — with 20+ of
   * these live per session (see store-hydrator.tsx), the default is too
   * aggressive for a store nobody edits concurrently in practice (company
   * config, departments, ...); pass a longer interval for those, and keep
   * this short only where people actually collide (report-feed,
   * notifications). Pass `false` to skip polling entirely — a conflicting
   * save still merges correctly via the 409 path, this only controls
   * whether *other people's* saves show up without you touching anything.
   */
  pollMs = DEFAULT_POLL_MS,
}: {
  apiKey: StoreKey;
  store: AnyStore<T>;
  select: (state: T) => S;
  apply: (state: T, slice: S) => T;
  pollMs?: number | false;
}) {
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<S | null>(null);
  const versionRef = useRef<number | null>(null);
  // The slice as the server last confirmed it — the common ancestor for the
  // 3-way merge on conflict. Kept in sync on every load and every successful save.
  const baseRef = useRef<S | null>(null);
  // True while we're writing server-originated data into the store (load, poll,
  // merge). The subscribe listener checks this so pulling in a teammate's save
  // doesn't get mistaken for a local edit and echoed straight back — which
  // would otherwise bounce identical no-op writes between tabs every poll.
  const applyingRemoteRef = useRef(false);
  // บันทึกที่กำลังส่งอยู่ + ตัวนับที่ขยับทุกครั้งที่เริ่ม/จบการบันทึก — ให้รอบดึงข้อมูล (poll)
  // รู้ว่ามีการบันทึกเกิดขึ้นระหว่างที่มันรอคำตอบ แล้วทิ้งข้อมูลชุดนั้นไป
  // ("กดโพสแล้วหาย": poll ยิงก่อนโพสต์ถึงเซิร์ฟเวอร์ ได้ข้อมูลชุดที่ยังไม่มีโพสต์ใหม่
  // แต่คำตอบมาถึงหลังบันทึกเสร็จ เลยเอาชุดเก่ามาทับ — แล้วแก้อะไรต่อ ชุดเก่านั้นจะถูก
  // ส่งกลับขึ้นไปทับบนเซิร์ฟเวอร์ด้วย)
  const savingRef = useRef(0);
  const saveSeqRef = useRef(0);
  // มีการแก้ไขในเครื่องที่ยังไม่ถึงเซิร์ฟเวอร์ (แก้เพิ่มระหว่างกำลังบันทึก / บันทึกไม่สำเร็จรอลองใหม่)
  const dirtyRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    function applyRemoteState(mutator: (s: T) => T) {
      applyingRemoteRef.current = true;
      try {
        store.setState(mutator);
      } finally {
        applyingRemoteRef.current = false;
      }
    }

    // GET the current server slice + version. `slice` is null for a store the
    // company has never saved yet.
    async function fetchServer(): Promise<{ slice: S | null; version: number | null }> {
      const res = await fetch(`/api/report-task/store/${apiKey}`, { cache: "no-store" });
      const version = Number(res.headers.get("X-Data-Version")) || null;
      const slice = (await res.json()) as S | null;
      return { slice, version };
    }

    async function load() {
      try {
        const { slice, version } = await fetchServer();
        versionRef.current = version;
        // A brand-new store has nothing saved server-side yet (slice is null) —
        // still run `apply` (with the store's own current slice as a no-op
        // merge) so callers that bake bookkeeping like `loaded: true` into
        // `apply` see it regardless of whether the server had data.
        if (!cancelled) {
          applyRemoteState((s) => apply(s, slice != null ? slice : select(s)));
          baseRef.current = select(store.getState()); // in sync with the server now
        }
      } catch {
        toast.error(`โหลดข้อมูลไม่สำเร็จ (${apiKey}) ลองรีเฟรชหน้า`);
      } finally {
        loadedRef.current = true;
      }
    }

    /*
     * การบันทึก — หลักการ: "ห้ามทิ้งสิ่งที่ผู้ใช้เพิ่งทำ" และ "ห้ามเขียนทับของคนอื่น"
     *
     * บั๊ก "ส่งรีพอตพร้อมกันแล้วบางคนโพสต์หาย" มาจากของเดิม 3 จุด:
     *  1. ส่ง *สำเนาที่ถ่ายไว้ตอนแก้ไข* ไม่ใช่ข้อมูลปัจจุบัน — ถ้าระหว่างกำลังบันทึกมีการแก้ไขในเครื่อง
     *     อีกครั้ง (แค่ระบบทำเครื่องหมาย "อ่านแล้ว" ก็นับ) สำเนานั้นถ่ายก่อนที่ของคนอื่นจะถูกรวมเข้ามา
     *     พอส่งขึ้นไปด้วยเลขเวอร์ชันล่าสุด เซิร์ฟเวอร์รับ → โพสต์ของคนอื่นหายสำหรับทุกคน
     *     (หรือถ้าชน 409 ตัวรวมจะมองว่า "ฉันลบโพสต์นั้น" เพราะ base มีแต่ของฉันไม่มี)
     *  2. แพ้การแย่งบันทึกครบ 4 รอบ → load() ทับ = ทิ้งโพสต์ที่เพิ่งกดส่ง เงียบ ๆ
     *  3. เน็ตสะดุดตอนส่ง → load() ทับทันที = โพสต์หาย
     *
     * ตอนนี้: บันทึกทีละรอบเดียว (ไม่ซ้อน) · ส่งข้อมูล *ปัจจุบันของ store* เสมอ · ตอนชน 409 รวมจาก
     * ข้อมูลปัจจุบัน (รวมที่แก้ระหว่างรอ) · ไม่สำเร็จ = เก็บไว้ในเครื่องแล้วลองใหม่เรื่อย ๆ ไม่ทิ้ง
     */
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    /** true = เซิร์ฟเวอร์ตรงกับเครื่องแล้ว (หรือกู้ไม่ได้และโหลดของเซิร์ฟเวอร์กลับมาแล้ว) · false = ยังไม่ได้ ต้องลองใหม่ */
    async function putWithMerge(): Promise<boolean> {
      let mine = select(store.getState());
      // ชนกันได้หลายรอบตอนหลายคนส่งพร้อมกัน (ทั้งก้อนใหญ่ ส่ง/ดึงใช้เวลา) — ให้โอกาสมากพอ + เว้นจังหวะสุ่ม
      // ไม่ให้ทุกเครื่องยิงซ้ำพร้อมกันอีก ครบแล้วยังไม่ได้ก็ "ลองใหม่ทีหลัง" ไม่ใช่ทิ้ง
      for (let attempt = 0; attempt < 8; attempt++) {
        let res: Response;
        try {
          res = await fetch(`/api/report-task/store/${apiKey}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: mine, expectedVersion: versionRef.current }),
          });
        } catch {
          return false; // เน็ตสะดุด — เก็บของในเครื่องไว้ ลองใหม่
        }

        if (res.status === 409) {
          // มีคนบันทึกก่อน — ดึงของล่าสุด รวมสิ่งที่เครื่องนี้เปลี่ยนทับลงไป แล้วส่งใหม่
          let latest: { slice: S | null; version: number | null };
          try {
            latest = await fetchServer();
          } catch {
            return false;
          }
          // รวมจากข้อมูล "ปัจจุบัน" ของ store (ไม่ใช่ชุดที่ส่งไปเมื่อกี้) — สิ่งที่ผู้ใช้แก้เพิ่มระหว่างรอ
          // ต้องอยู่ครบ และของคนอื่นที่เพิ่งมาต้องไม่ถูกมองว่า "ฉันลบ"
          const current = select(store.getState());
          const merged = mergeThreeWay(baseRef.current, current, latest.slice) as NonNullable<S>;
          applyRemoteState((s) => apply(s, merged));
          versionRef.current = latest.version;
          baseRef.current = latest.slice; // what the server had when we merged
          mine = select(store.getState());
          await sleep(40 + Math.random() * 120 * (attempt + 1));
          continue; // retry PUT with merged data + the latest version
        }

        if (!res.ok) {
          // ทิ้งของในเครื่องเฉพาะเมื่อเซิร์ฟเวอร์ "ปฏิเสธข้อมูลนี้จริง" (ผิดรูป 400 / ใหญ่เกิน 413) ที่เหลือลองใหม่หมด:
          // เซิร์ฟเวอร์ล่ม/กำลังรีสตาร์ต (5xx) · ถูกจำกัดความถี่ · session ต่ออายุไม่ทัน (401) · และ 404 ซึ่งคีย์ที่
          // ถูกต้องเจอได้เฉพาะตอนกำลัง deploy (build ทับไฟล์ของตัวที่รันอยู่) — เดิมเคสพวกนี้ตกไป "โหลดของ
          // เซิร์ฟเวอร์กลับมาทับ" โพสต์ที่เพิ่งกดส่งระหว่าง deploy เลยหาย
          if (res.status !== 400 && res.status !== 413) return false;
          // ปฏิเสธจริง — ส่งซ้ำก็ไม่ผ่าน ให้หน้าจอตรงกับเซิร์ฟเวอร์
          toast.error(
            res.status === 413
              ? "ข้อมูลใหญ่เกินกว่าที่บันทึกได้ — แจ้งผู้ดูแลระบบ (การเปลี่ยนแปลงล่าสุดไม่ถูกบันทึก)"
              : "บันทึกข้อมูลไม่สำเร็จ กำลังโหลดข้อมูลล่าสุดกลับมา",
            { id: `storesync-save-error-${apiKey}` }
          );
          await load();
          return true;
        }

        const data = (await res.json().catch(() => null)) as { version?: number } | null;
        // 200 แต่ไม่ใช่คำตอบของ API นี้ (หน้า HTML ของ proxy ตอนเซิร์ฟเวอร์กำลังขึ้น ฯลฯ) = ยังไม่ได้บันทึก
        // ถ้านับว่าสำเร็จ รอบดึงข้อมูลถัดไปจะเอาของเซิร์ฟเวอร์มาทับสิ่งที่ผู้ใช้เพิ่งทำ
        if (typeof data?.version !== "number") return false;
        versionRef.current = data.version;
        baseRef.current = mine; // this snapshot is now the server truth
        return true;
      }
      return false; // แย่งไม่ทันทุกรอบ — ลองใหม่ทีหลัง ไม่ทิ้ง
    }

    /** บันทึกทีละรอบเดียว — มีการแก้ไขเข้ามาระหว่างบันทึก = วนส่งอีกรอบด้วยข้อมูลล่าสุด */
    async function runSave() {
      if (savingRef.current > 0) {
        dirtyRef.current = true;
        return;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      savingRef.current++;
      saveSeqRef.current++;
      try {
        do {
          dirtyRef.current = false;
          const ok = await putWithMerge();
          if (!ok) {
            // ยังไม่ถึงเซิร์ฟเวอร์ — เก็บไว้ ลองใหม่ห่างขึ้นเรื่อย ๆ (2, 4, 8 … สูงสุด 30 วิ)
            dirtyRef.current = true;
            failuresRef.current++;
            const wait = Math.min(30_000, 2000 * 2 ** Math.min(failuresRef.current - 1, 4));
            if (failuresRef.current >= 2) {
              toast.error("ยังบันทึกไม่สำเร็จ — ระบบกำลังลองใหม่ให้อัตโนมัติ อย่าเพิ่งปิดหน้านี้", {
                id: `storesync-retrying-${apiKey}`,
                duration: 60_000,
              });
            }
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              void runSave();
            }, wait);
            return;
          }
          if (failuresRef.current >= 2) {
            toast.success("บันทึกเรียบร้อยแล้ว", { id: `storesync-retrying-${apiKey}`, duration: 3000 });
          }
          failuresRef.current = 0;
        } while (dirtyRef.current);
      } finally {
        savingRef.current--;
        saveSeqRef.current++;
      }
    }

    /** ตัวหน่วง 500ms ครบ / ออกจากหน้า (in-page) — เริ่มบันทึกข้อมูลปัจจุบัน */
    function flushPending() {
      const hadEdit = pendingRef.current != null || dirtyRef.current;
      pendingRef.current = null;
      // The debounce timer that scheduled this flush has now fired and is
      // spent — clear the id too, not just pendingRef. Left set, the poll
      // guard (`canPullNow`) reads this stale, already-consumed setTimeout id
      // as "an edit is still in flight" forever, permanently skipping every
      // future poll tick for the life of this mount.
      timerRef.current = null;
      if (!hadEdit) return;
      void runSave();
    }

    /** ปิดแท็บ/ออกจากหน้า — ยิงครั้งเดียวแบบ keepalive (รอผล/รวม/ลองใหม่ไม่ได้) ให้แท็บอื่นหรือการเปิดครั้งหน้ารวมให้
     * `keepalive` รับ body ได้ ~64KB ใน Chromium ก้อนใหญ่กว่านั้นเบราว์เซอร์จะไม่ส่ง — การบันทึกปกติจึงไม่ใช้ทางนี้ */
    function flushOnUnload() {
      if (pendingRef.current == null && !dirtyRef.current) return;
      pendingRef.current = null;
      try {
        void fetch(`/api/report-task/store/${apiKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: select(store.getState()), expectedVersion: versionRef.current }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        /* best effort on the way out */
      }
    }

    void load();

    // ให้ส่วนอื่นของแอป (ตัวโหลดหน้าใหม่เมื่อมีเวอร์ชันใหม่) รู้ว่ายังมีของที่ไม่ถึงเซิร์ฟเวอร์ — ดู lib/unsaved-work.ts
    const unregisterProbe = registerSyncProbe(
      apiKey,
      () =>
        pendingRef.current != null ||
        timerRef.current != null ||
        savingRef.current > 0 ||
        dirtyRef.current ||
        retryTimerRef.current != null
    );

    const unsub = store.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (applyingRemoteRef.current) return; // server-originated, not a user edit
      const next = select(state);
      const before = select(prev);
      // `select` typically returns a fresh object/array literal on every call,
      // so a reference compare to `select(prev)` is always unequal even when
      // nothing changed. Fast path first: every field the same reference (the
      // stores update immutably) = nothing changed, without serializing the
      // whole slice — the report feed is several MB and stringifying it twice
      // on the main thread on every store update was visible as UI lag.
      if (sameFields(next, before)) return;
      if (JSON.stringify(next) === JSON.stringify(before)) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = next;
      timerRef.current = setTimeout(flushPending, 500);
    });

    // Pull in teammates' saves. Primary path is the realtime pipe: every save
    // on the server announces { type: "store.changed", key, version } to the
    // whole company (org-store.ts announceStoreChanged), so this tab fetches
    // the moment something changes — like Facebook/LINE, instead of every tab
    // asking "anything new?" every few seconds. The interval below is only a
    // safety net: full speed while the pipe is down, once a minute while it's
    // up (a missed event can't leave a tab stale for long).
    //
    // Skip while the user has an unsaved edit in flight (don't yank their
    // work) or the tab is hidden — a signal that lands then is remembered
    // (`signalRef`) and pulled as soon as it's safe. `pollMs: false` opts a
    // store out of the fallback poll; realtime signals still apply.
    const signalRef = { current: false };
    let lastPull = Date.now();

    function canPullNow(): boolean {
      if (!loadedRef.current) return false;
      if (pendingRef.current || timerRef.current || savingRef.current > 0) return false;
      // ยังมีของในเครื่องที่ไม่ถึงเซิร์ฟเวอร์ (รอลองบันทึกใหม่) — ห้ามดึงของเซิร์ฟเวอร์มาทับ
      if (dirtyRef.current || retryTimerRef.current) return false;
      // Some edits are staged locally and haven't been written to the
      // store yet, so the two guards above can't see them — see
      // holdServerSync's own comment for why landing a poll on top of
      // one of those (an in-progress drag reorder) breaks it outright.
      if (isServerSyncHeld()) return false;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      return true;
    }

    async function pull() {
      lastPull = Date.now();
      signalRef.current = false;
      const seqAtStart = saveSeqRef.current;
      try {
        // บอก version ที่ถืออยู่ — ไม่มีอะไรใหม่เซิร์ฟเวอร์ตอบ 204 ไม่มี body
        const res = await fetch(`/api/report-task/store/${apiKey}`, {
          cache: "no-store",
          headers: versionRef.current != null ? { "X-Known-Version": String(versionRef.current) } : undefined,
        });
        if (res.status === 204) return; // nothing new
        if (!res.ok) return;
        const version = Number(res.headers.get("X-Data-Version")) || null;
        if (version === versionRef.current) return; // nothing new
        if (pendingRef.current || timerRef.current || dirtyRef.current || retryTimerRef.current) {
          signalRef.current = true; // user started editing meanwhile — try again after
          return;
        }
        // มีการบันทึกเริ่ม/จบระหว่างรอคำตอบ — ข้อมูลชุดนี้อาจเก่ากว่าที่เพิ่งบันทึก ทิ้งไป รอบหน้าค่อยดึงใหม่
        if (savingRef.current > 0 || saveSeqRef.current !== seqAtStart) {
          signalRef.current = true;
          return;
        }
        // เก่ากว่าที่เรารู้อยู่แล้ว (เลขเวอร์ชันเพิ่มขึ้นทุกครั้งที่บันทึก) — ไม่เอามาทับ
        if (version != null && versionRef.current != null && version < versionRef.current) return;
        const slice = (await res.json()) as S | null;
        if (cancelled) return;
        versionRef.current = version;
        if (slice != null) {
          applyRemoteState((s) => apply(s, slice));
          baseRef.current = select(store.getState());
        }
      } catch {
        signalRef.current = true; // transient — next tick will retry
      }
    }

    const offRealtime = subscribeRealtime((event) => {
      if (event.type === "realtime.reconnected") {
        // หลุดไปช่วงหนึ่ง อาจพลาดสัญญาณ — ดึงเช็คทันที
        if (canPullNow()) void pull();
        else signalRef.current = true;
        return;
      }
      if (event.type !== "store.changed" || event.key !== apiKey) return;
      const version = typeof event.version === "number" ? event.version : null;
      if (version != null && versionRef.current != null && version <= versionRef.current) return; // มีแล้ว (มักเป็นที่ตัวเองเพิ่งบันทึก)
      if (canPullNow()) void pull();
      else signalRef.current = true;
    });

    function onVisible() {
      if (document.visibilityState === "visible" && signalRef.current && canPullNow()) void pull();
    }
    document.addEventListener("visibilitychange", onVisible);

    const poll =
      pollMs === false
        ? setInterval(() => {
            if (signalRef.current && canPullNow()) void pull();
          }, DEFAULT_POLL_MS)
        : setInterval(() => {
            if (!canPullNow()) return;
            // ท่อสดต่ออยู่ = สัญญาณมาเองแล้ว เช็คสำรองนาทีละครั้งพอ (เว้นมีสัญญาณค้าง)
            const fallbackMs = realtimeStatus() === "open" ? Math.max(pollMs, REALTIME_FALLBACK_MS) : pollMs;
            if (!signalRef.current && Date.now() - lastPull < fallbackMs) return;
            void pull();
          }, Math.min(pollMs, DEFAULT_POLL_MS));

    window.addEventListener("pagehide", flushOnUnload);

    return () => {
      cancelled = true;
      unregisterProbe();
      unsub();
      offRealtime();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(poll);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (retryTimerRef.current) {
        // คอมโพเนนต์ถูกถอด (เปลี่ยนหน้าในแอป) ระหว่างรอลองใหม่ — ลองส่งอีกครั้งตอนนี้เลย
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      window.removeEventListener("pagehide", flushOnUnload);
      flushPending();
    };
    // apiKey/store/select/apply are expected to be stable identities from the
    // caller (module-scope store hooks, inline selectors defined per mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, store]);

  return null;
}
