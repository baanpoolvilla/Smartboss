"use client";

import { useState, type ReactNode } from "react";
import { docThumbSrc } from "@/lib/doc-thumb";
import { ReportFileChip } from "@/modules/report_task/components/report-feed/report-file-chip";
import { fileKindOf } from "@/modules/report_task/lib/report-attachment-kind";
import { cn } from "@/modules/report_task/lib/utils";

/** สีป้ายชนิดไฟล์ — โทนเดียวกับ ReportFileChip จำสีได้เหมือนกันทั้งแอป */
function docBadgeTone(mime?: string) {
  switch (fileKindOf(mime ?? "")) {
    case "pdf":
      return "bg-[var(--chart-red)]";
    case "word":
      return "bg-[var(--chart-blue)]";
    case "excel":
      return "bg-[var(--chart-green)]";
    case "powerpoint":
      return "bg-[var(--chart-orange)]";
    default:
      return "bg-[var(--ink-soft)]";
  }
}

/** แถบชนิดไฟล์ + ชื่อไฟล์ใต้รูปหน้าแรก — วางทับขอบล่างของกรอบ relative */
export function DocNameBar({ name, mime }: { name: string; mime?: string }) {
  return (
    <span
      className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-[var(--line)] bg-white/95 px-1.5 py-1 text-left"
      title={name}
    >
      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-white", docBadgeTone(mime))}>
        {fileKindOf(mime ?? "")}
      </span>
      <span className="min-w-0 truncate text-[11px] font-medium leading-tight text-[var(--ink)]">{name}</span>
    </span>
  );
}

/** เอกสารหนึ่งไฟล์: รูปหน้าแรก + ชื่อ · ไม่มีรูป = การ์ดไอคอนพร้อมชื่อ */
export function DocAttachmentCard({
  media,
  className,
}: {
  media: { url?: string; thumbUrl?: string; name: string; mime?: string; size?: number };
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const thumb = docThumbSrc(media);
  if (!thumb || thumb === failed) {
    // สัดส่วนเท่าการ์ดรูป — วางเรียงกันแล้วสูงเท่ากัน
    return <ReportFileChip media={media} className={cn("aspect-[3/4] w-40", className)} />;
  }
  return (
    <span className={cn("relative block aspect-[3/4] w-40 overflow-hidden rounded-lg border border-[var(--line)] bg-white", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumb}
        alt={media.name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(thumb)}
        className="h-full w-full object-cover object-top"
      />
      <DocNameBar name={media.name} mime={media.mime} />
    </span>
  );
}

/** รูปหน้าแรกขนาดเล็กในแถวรายการไฟล์ (ชื่ออยู่ข้าง ๆ แล้ว) · ไม่มีรูป = fallback */
export function DocThumbMini({
  media,
  fallback,
  className,
}: {
  media: { url?: string; thumbUrl?: string; name: string };
  fallback: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const thumb = docThumbSrc(media);
  if (!thumb || thumb === failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumb}
      alt={media.name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(thumb)}
      className={cn("rounded border border-[var(--line)] bg-white object-cover object-top", className)}
    />
  );
}
