"use client";

import { useEffect, useRef } from "react";

/**
 * ปุ่มย้อนกลับ (ปุ่ม back ของ Android / ปัดย้อนของ iPhone / ปุ่ม ← ของเบราว์เซอร์) ปิดหน้าต่างที่
 * เปิดซ้อนอยู่ก่อน แทนที่จะออกจากหน้า/ออกจากแอปไปเลย
 *
 * ตอนหน้าต่างเปิด → ดันประวัติเพิ่ม 1 ช่อง (URL เดิม แปะ `__btc: id`) · กดย้อนกลับ → popstate
 * พบว่าช่องที่ตกลงมามี id ต่ำกว่า → ปิดหน้าต่างที่ id สูงกว่า (ซ้อนกันหลายชั้นก็ปิดทีละชั้น)
 * ปิดเองด้วยปุ่มในหน้า (✕ / กดพื้นหลัง / Esc) → ถอยช่องที่ดันไว้คืน ประวัติจะได้ไม่ค้างช่องว่าง
 * (กดย้อนแล้ว "ไม่เกิดอะไรขึ้น")
 *
 * การถอย/ดันทั้งหมดในรอบเดียวกัน (ปิดหน้าต่าง + เปิดอันใหม่ / เปลี่ยน URL) รวบไปทำทีเดียวใน
 * settle() หลังเรนเดอร์เสร็จ — history.back() ทำงานทีหลัง (async) ถ้าดันช่องใหม่ระหว่างนั้น
 * การถอยจะไปโดนช่องใหม่แทน
 */

interface Entry {
  id: number;
  close: () => void;
  popped: boolean;
}

const stack: Entry[] = [];
let nextId = 1;
let installed = false;

/** งานที่รอ settle — หน้าต่างที่ปิดเองต้องถอยคืน, หน้าต่างที่เพิ่งเปิดต้องดันช่อง, URL ที่หน้าอยากดัน */
const toRetract: Entry[] = [];
const toPush: Entry[] = [];
let urlToPush: string | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
/** งานที่รอให้ประวัติ "นิ่ง" ก่อน (ถอยช่องของหน้าต่างที่ปิดเสร็จแล้ว) — ดู whenHistorySettled */
const settledWaiters: (() => void)[] = [];
function flushWaiters() {
  for (const fn of settledWaiters.splice(0)) {
    try {
      fn();
    } catch (err) {
      console.error("[back-to-close] waiter failed", err);
    }
  }
}
/** ถอยไปแล้วกี่ช่องที่ยังรอ popstate — ระหว่างนี้งานดันต้องรอ */
let backsInFlight = 0;
let backsTimer: ReturnType<typeof setTimeout> | null = null;
/** ที่อยู่หน้าเว็บตอนสั่งถอย — ถอยแล้วที่อยู่เท่าเดิม = เป็นแค่ช่องของหน้าต่าง Next ไม่ต้องรู้ */
let hrefBeforeBack = "";
/** เวลาที่เพิ่งกดลิงก์ไปหน้าอื่น — หน้าต่างที่ปิดตามมาไม่ต้องถอยประวัติ */
let linkNavUntil = 0;

function currentId(): number {
  const s = window.history.state as { __btc?: unknown } | null;
  return typeof s?.__btc === "number" ? s.__btc : 0;
}

function scheduleSettle() {
  if (!settleTimer) settleTimer = setTimeout(settle, 0);
}

function settle() {
  settleTimer = null;
  if (backsInFlight > 0) return; // popstate จะเรียกอีกที
  const cur = currentId();
  // ปิดเพราะกดลิงก์ไปหน้าอื่น / router.push ไปแล้ว (ช่องปัจจุบันไม่ใช่ของหน้าต่าง) → ห้ามถอย
  // ไม่งั้นลบการนำทางนั้นทิ้ง ช่องว่างที่เหลือค้างไว้หลังหน้าใหม่ไม่เป็นไร ย้อนมาก็เจอหน้าเดิม
  const retract = Date.now() < linkNavUntil ? 0 : toRetract.filter((e) => e.id <= cur).length;
  toRetract.length = 0;
  if (retract > 0) {
    if (retract === 1 && urlToPush && toPush.length === 0) {
      // ปิดแผงแล้วเปลี่ยนไปหน้าใหม่ทันที (เช่น เลือกห้องจากแผงรายการห้อง) → เขียน URL ใหม่ทับ
      // ช่องของแผงเลย ประวัติเป็น [ห้องเดิม, ห้องใหม่] พอดี และไม่มี popstate ให้หน้าสับสน
      window.history.replaceState(null, "", urlToPush);
      urlToPush = null;
      flushWaiters();
      return;
    }
    backsInFlight = retract;
    hrefBeforeBack = window.location.href;
    window.history.go(-retract);
    // กันค้าง — ถ้า popstate ไม่มา (ถอยไม่ได้) ก็ทำงานที่รออยู่ต่อเลย
    if (backsTimer) clearTimeout(backsTimer);
    backsTimer = setTimeout(() => {
      backsInFlight = 0;
      settle();
    }, 600);
    return;
  }
  if (urlToPush) {
    window.history.pushState(null, "", urlToPush);
    urlToPush = null;
  }
  for (const e of toPush.splice(0)) {
    e.id = nextId++;
    stack.push(e);
    window.history.pushState({ __btc: e.id }, "");
  }
  flushWaiters();
}

/**
 * รอให้การถอยประวัติของหน้าต่างที่เพิ่งปิด "เสร็จจริง" ก่อนค่อยทำ fn — ใช้ก่อน router.push ไปหน้าอื่น
 * ทันทีหลังปิดป๊อปอัป (เช่น กดแจ้งเตือนในกระดิ่ง): history.go(-1) ของการปิดเป็นงาน async ถ้ามันมา
 * ทีหลัง router.push มันจะถอยทับการนำทางนั้น หน้าเปลี่ยนแล้วเด้งกลับ / ?task= หาย หน้าต่างงานปิด
 * ("กดแจ้งเตือนแล้วเด้งมาหน้าบอร์ด กดอีกทีถึงจะเปิดงาน")
 */
export function whenHistorySettled(fn: () => void) {
  if (typeof window === "undefined") return fn();
  install();
  // เว้นจังหวะสั้น ๆ ให้หน้าต่างที่กำลังปิดลงทะเบียน "ขอถอยช่อง" ก่อน (เกิดหลัง React render รอบนี้)
  // ไม่งั้นรอบ settle แรกยังไม่เห็นอะไรให้ถอย แล้วปล่อย fn ไปก่อน — กลับไปเจอปัญหาเดิม
  setTimeout(() => {
    settledWaiters.push(fn);
    scheduleSettle();
  }, 30);
}

function install() {
  if (installed) return;
  installed = true;
  // id ต่อจากของเดิมหลังรีเฟรช — ช่องเก่าในประวัติยังถือ id เดิมอยู่
  nextId = Math.max(nextId, currentId() + 1);
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search !== window.location.pathname + window.location.search) linkNavUntil = Date.now() + 1500;
    },
    true
  );
  // capture + stopImmediatePropagation: popstate ของ "การถอยที่เราสั่งเอง" (ลบช่องของหน้าต่างที่ปิด)
  // ต้องไม่ไปถึงตัวจัดการของ Next — Next เห็น popstate แล้วถือว่าผู้ใช้กดย้อนกลับ จะยกเลิกการเปลี่ยนหน้า
  // ที่เพิ่งสั่งไป (router.push จากปุ่มในเมนู) ผลคือ "กดเมนูแล้วไม่ไปไหน" บนมือถือ
  // (ช่องของหน้าต่างเป็น URL เดียวกับหน้าที่ Next อยู่ — Next ไม่ต้องรู้เรื่องช่องพวกนี้เลย)
  window.addEventListener("popstate", (ev) => {
    if (backsInFlight > 0) {
      // popstate ของการถอยที่เราสั่งเอง — ไม่ใช่ผู้ใช้กดย้อนกลับ
      // ที่อยู่ไม่เปลี่ยน = ซ่อนจาก Next · ที่อยู่เปลี่ยนจริง (หน้าเขียน URL ทับช่องของหน้าต่างไว้) ให้ Next รับรู้ตามปกติ
      if (window.location.href === hrefBeforeBack) ev.stopImmediatePropagation();
      backsInFlight = 0;
      if (backsTimer) clearTimeout(backsTimer);
      backsTimer = null;
      scheduleSettle();
      return;
    }
    const landed = currentId();
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i]!;
      if (e.id <= landed) continue;
      e.popped = true;
      stack.splice(i, 1);
      e.close();
    }
  }, true);
}

/**
 * ดันประวัติไปที่ URL ใหม่ (pushState ไม่โหลดหน้าใหม่) แบบที่เข้ากับหน้าต่างที่กำลังปิด — เช่น
 * เลือกห้องจากแผงรายการห้องบนมือถือ: แผงปิด + เปลี่ยนห้องพร้อมกัน ได้ประวัติ [ห้องเดิม, ห้องใหม่]
 * กดย้อนกลับทีเดียวกลับห้องเดิม
 */
export function pushUrlAfterOverlays(url: string) {
  install();
  urlToPush = url;
  scheduleSettle();
}

/** state ของช่องประวัติปัจจุบันที่ต้องคงไว้ — ใช้กับ history.replaceState ของหน้าเอง ไม่งั้นหน้าต่างที่เปิดอยู่หลุดจากปุ่มย้อนกลับ */
export function overlayHistoryState(): { __btc: number } | null {
  if (typeof window === "undefined") return null;
  const id = currentId();
  return id ? { __btc: id } : null;
}

/** ให้ปุ่มย้อนกลับปิดหน้าต่างนี้ — `open` = เปิดอยู่ไหม (คอมโพเนนต์ที่ mount = เปิด ส่ง true ได้เลย) */
export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    install();
    const entry: Entry = { id: 0, close: () => closeRef.current(), popped: false };
    toPush.push(entry);
    scheduleSettle();
    return () => {
      const w = toPush.indexOf(entry);
      if (w >= 0) {
        toPush.splice(w, 1); // ยังไม่ทันดันช่อง — ไม่มีอะไรต้องถอย
        return;
      }
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (entry.popped) return;
      toRetract.push(entry);
      scheduleSettle();
    };
  }, [open]);
}

/**
 * แบบเดียวกับ useBackToClose แต่เฉพาะเครื่องจอสัมผัส — ใช้กับป๊อปอัปเล็ก/เมนู/ช่องตัวเลือก
 * มาตรฐาน Android: ปุ่มย้อนกลับปิดสิ่งที่เปิดซ้อนอยู่บนสุดก่อนเสมอ ส่วนคอมไม่มีปุ่มย้อนกลับของเครื่อง
 * (เมนูเปิด/ปิดถี่ ๆ ด้วยเมาส์ ไม่ควรไปแตะประวัติของเบราว์เซอร์)
 */
export function useBackToCloseOnTouch(open: boolean, onClose: () => void) {
  const touch = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  useBackToClose(open && touch, onClose);
}
