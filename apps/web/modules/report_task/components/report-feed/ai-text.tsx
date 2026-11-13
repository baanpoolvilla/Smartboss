"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * คำตอบของ AI — จัดรูปให้อ่านง่าย (13/11/2569 ผู้ใช้: "แก้ฟอร์มให้สวยๆ ได้ไหม ยังดูยากไปหน่อย")
 * - บรรทัด "- " / "• " / "1. " = รายการ มีจุดนำหน้า เว้นระยะ · หัวข้อต้นข้อ (ก่อน " — " หรือ ":") เป็นตัวหนา
 * - [ข้อความ](/path) = ปุ่มลิงก์เล็กในแอป ("พาไปได้") รับเฉพาะลิงก์ในระบบ (ขึ้นต้น / ไม่ใช่ //)
 * - บรรทัด "💡" = ข้อเสนอของ AI แยกเป็นกล่องสีอ่อน ไม่ปนกับข้อมูลจริง
 * - บรรทัดแรก (ถ้าไม่ใช่รายการ) = สรุป ตัวหนาเล็กน้อย
 */
const LINK = /\[([^\]\n]{1,120})\]\(\s*(\/(?!\/)[^)\s]{0,400})\s*\)/g;
const BULLET = /^\s*(?:[-•*]|\d{1,2}[.)])\s+/;

function inline(text: string, onNavigate?: () => void, keyBase = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK.lastIndex = 0;
  while ((m = LINK.exec(text))) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}t${last}`}>{text.slice(last, m.index)}</Fragment>);
    out.push(
      <Link
        key={`${keyBase}l${m.index}`}
        href={m[2]!}
        onClick={onNavigate}
        className="mx-0.5 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-[var(--brand-navy)]/25 bg-[var(--bg-soft)] px-2 py-px align-baseline text-[12px] font-medium text-[var(--brand-navy)] no-underline hover:border-[var(--brand-navy)] hover:bg-white"
      >
        {m[1]!.trim()} <span aria-hidden="true">›</span>
      </Link>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}t${last}`}>{text.slice(last)}</Fragment>);
  return out;
}

/** "ภีม (12 พ.ย.) — วางแผน…" / "ภีม: วางแผน…" → หัวตัวหนา + รายละเอียด (หัวต้องสั้นและไม่มีลิงก์) */
function headed(text: string, onNavigate: (() => void) | undefined, key: string): ReactNode {
  const dash = text.indexOf(" — ");
  const colon = text.indexOf(": ");
  const cut = dash > 0 && dash <= 60 ? dash : colon > 0 && colon <= 45 ? colon : -1;
  if (cut > 0 && !text.slice(0, cut).includes("](")) {
    const sep = text.startsWith(" — ", cut) ? 3 : 2;
    return (
      <>
        <b className="font-semibold text-[var(--ink)]">{text.slice(0, cut)}</b>
        <span className="text-[var(--ink-soft)]"> — </span>
        {inline(text.slice(cut + sep), onNavigate, key)}
      </>
    );
  }
  return inline(text, onNavigate, key);
}

export function AiText({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  // AI บางครั้งพิมพ์ลิงก์เป็น "(\/report-task/…)" (เจอจริง 13/11/2569) → คืนเป็น "/"
  const lines = text.replaceAll("**", "").replaceAll("\\/", "/").replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`ul${k}`} className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-navy)]/60" />
            <span className="min-w-0 flex-1">{headed(it, onNavigate, `li${k}-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return flush(i);
    if (BULLET.test(line)) {
      list.push(line.replace(BULLET, ""));
      return;
    }
    flush(i);
    if (line.startsWith("💡")) {
      blocks.push(
        <div key={`tip${i}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[var(--ink)]">
          {inline(line, onNavigate, `tip${i}`)}
        </div>
      );
      return;
    }
    const first = blocks.length === 0;
    blocks.push(
      <p key={`p${i}`} className={first ? "font-medium text-[var(--ink)]" : "text-[var(--ink)]"}>
        {inline(line, onNavigate, `p${i}`)}
      </p>
    );
  });
  flush(lines.length);
  return <div className="flex flex-col gap-2.5 leading-relaxed text-[var(--ink)]">{blocks}</div>;
}
