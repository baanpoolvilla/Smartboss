"use client";

/**
 * จำเส้นทางที่ผู้ใช้เดินมาจริงในแท็บนี้ ให้ปุ่มย้อนกลับกลับไป "หน้าก่อนหน้า" ไม่ใช่ปลายทางตายตัว
 * (ผู้ใช้ 4/11/2569 "กดเข้าไปหลายอัน กดกลับเด้งไปหน้าแรก ต้องกดกลับไปยังก่อนหน้าสิ")
 *
 * เก็บใน sessionStorage รีเฟรชแล้วไม่หาย แท็บใหม่เริ่มใหม่
 * n = ประวัติเบราว์เซอร์กี่ช่องที่อยู่บนหน้าเดียวกันนี้ (เปลี่ยนตัวกรอง/เดือน) — มากกว่า 1 ใช้ history ถอยตรง ๆ ไม่ได้
 */
const KEY = "sb-nav-stack";
const MAX = 50;

export interface NavEntry {
  u: string;
  n: number;
}

function read(): NavEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as NavEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(stack: NavEntry[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {
    // โหมดส่วนตัว/พื้นที่เต็ม — ปุ่มย้อนกลับใช้ปลายทางสำรองของหน้าแทน
  }
}

const pathOf = (url: string) => url.split("?")[0]!;

/** หน้าฟอร์มไม่ควรเป็นที่ย้อนกลับไป — บันทึกแล้วกดกลับต้องไม่กลับไปฟอร์มเดิม */
function isFormPage(url: string): boolean {
  return /\/(new|edit)$/.test(pathOf(url));
}

/** กฎล้วน แยกให้เทสต์ได้: เข้าหน้าใหม่ด้วยลิงก์/redirect */
export function visit(stack: NavEntry[], url: string): NavEntry[] {
  const top = stack[stack.length - 1];
  if (top?.u === url) return stack;
  if (top && pathOf(top.u) === pathOf(url)) return [...stack.slice(0, -1), { u: url, n: top.n + 1 }];
  return [...stack, { u: url, n: 1 }];
}

/** กฎล้วน: กดย้อน/ไปหน้าของเบราว์เซอร์หรือปุ่มมือถือ — เจอในเส้นทางก็ตัดกลับไปตรงนั้น ไม่เจอถือเป็นหน้าใหม่ */
export function pop(stack: NavEntry[], url: string): NavEntry[] {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (pathOf(stack[i]!.u) === pathOf(url)) return [...stack.slice(0, i), { u: url, n: stack[i]!.n }];
  }
  return visit(stack, url);
}

/**
 * กฎล้วน: ปุ่มย้อนกลับควรไปไหน — ข้ามหน้าฟอร์มและหน้าเดียวกับหน้าปัจจุบัน
 * direct = ถอยประวัติเบราว์เซอร์ช่องเดียวก็ถึงพอดี (รักษาตำแหน่งเลื่อน) · false = ต้องเปิดหน้าใหม่แทน
 */
export function backTarget(stack: NavEntry[]): { index: number; url: string; direct: boolean } | null {
  const top = stack[stack.length - 1];
  if (!top) return null;
  for (let i = stack.length - 2; i >= 0; i--) {
    const e = stack[i]!;
    if (pathOf(e.u) === pathOf(top.u) || isFormPage(e.u)) continue;
    return { index: i, url: e.u, direct: i === stack.length - 2 && top.n === 1 };
  }
  return null;
}

export function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

export function recordVisit(url: string) {
  write(visit(read(), url));
}

export function recordPop(url: string) {
  write(pop(read(), url));
}

/** เตรียมย้อนกลับ: คืนปลายทาง และตัดเส้นทางให้จบที่หน้านั้น · null = ไม่มีประวัติ ใช้ปลายทางสำรอง */
export function takeBackTarget(): { url: string; direct: boolean } | null {
  const stack = read();
  const target = backTarget(stack);
  if (!target) return null;
  write(stack.slice(0, target.index + 1));
  return { url: target.url, direct: target.direct };
}
