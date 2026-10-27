"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { filesFromDataTransfer, hasClipboardText } from "@/lib/annotate/annotate";

/**
 * กล่องรับไฟล์ที่ลากมาวาง — ระหว่างลากไฟล์ค้างไว้เหนือกล่องจะขึ้นกรอบเขียวพร้อมบอกว่า
 * ปล่อยแล้วไฟล์ไปไหน `enabled={false}` = ไม่รับ (เช่น คนที่ไม่มีสิทธิ์แนบส่วนนี้) ไฟล์ที่ปล่อย
 * ลงกล่องไม่ทะลุไปกล่องข้างนอก (stopPropagation) จึงซ้อนกันได้
 */
export function FileDropZone({
  enabled,
  onFiles,
  label,
  className = "",
  style,
  children,
  paste = false,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  /** ข้อความตอนลากค้างไว้ เช่น "ปล่อยเพื่อแนบเป็นไฟล์ส่งงาน" */
  label: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  /** รับรูปที่วางด้วย Ctrl+V ด้วย (คลิกในกล่องก่อนให้โฟกัสอยู่ในกล่อง) — ข้อความยังวางตามปกติ */
  paste?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  if (!enabled) return <div className={className} style={style}>{children}</div>;

  return (
    <div
      className={`relative ${paste ? "outline-none" : ""} ${className}`}
      style={style}
      tabIndex={paste ? -1 : undefined}
      onPaste={
        paste
          ? (e) => {
              if (e.defaultPrevented || hasClipboardText(e.clipboardData)) return;
              if ((e.target as HTMLElement).closest("[data-own-paste]")) return;
              const files = filesFromDataTransfer(e.clipboardData);
              if (files.length === 0) return;
              e.preventDefault();
              onFiles(files);
            }
          : undefined
      }
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        const files = filesFromDataTransfer(e.dataTransfer);
        depth.current = 0;
        setOver(false);
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--brand-green)] bg-[var(--brand-green)]/10 backdrop-blur-[1px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-[var(--brand-green)] shadow">
            <Upload className="h-4 w-4" /> {label}
          </span>
        </div>
      )}
    </div>
  );
}
