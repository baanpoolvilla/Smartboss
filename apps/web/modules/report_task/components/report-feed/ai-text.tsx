"use client";

import Link from "next/link";
import { Fragment } from "react";

/**
 * ข้อความคำตอบของ AI — ลิงก์แบบ [ข้อความ](/path) กลายเป็นปุ่มลิงก์ในแอป (13/11/2569 "พาไปได้")
 * รับเฉพาะลิงก์ในระบบ (ขึ้นต้นด้วย / ไม่ใช่ //) — ลิงก์ภายนอกหรือรูปแบบอื่นแสดงเป็นข้อความธรรมดา
 */
export function AiText({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const clean = text.replaceAll("**", "");
  const parts: { t: string; href?: string }[] = [];
  // ยอมให้มีเว้นวรรคในวงเล็บ — AI บางครั้งพิมพ์ "[ดูงาน]( /report-task/…)" (เจอจริง 13/11/2569)
  const re = /\[([^\]\n]{1,120})\]\(\s*(\/(?!\/)[^)\s]{0,400})\s*\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    if (m.index > last) parts.push({ t: clean.slice(last, m.index) });
    parts.push({ t: m[1]!, href: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < clean.length) parts.push({ t: clean.slice(last) });
  return (
    <p className="whitespace-pre-line leading-relaxed text-[var(--ink)]">
      {parts.map((p, i) =>
        p.href ? (
          <Link key={i} href={p.href} onClick={onNavigate} className="font-medium text-[var(--brand-navy)] underline decoration-[var(--brand-navy)]/40 underline-offset-2 hover:decoration-[var(--brand-navy)]">
            {p.t} ›
          </Link>
        ) : (
          <Fragment key={i}>{p.t}</Fragment>
        )
      )}
    </p>
  );
}
