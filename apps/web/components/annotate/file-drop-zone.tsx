"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { filesFromDataTransfer } from "@/lib/annotate/annotate";

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
  children,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  /** ข้อความตอนลากค้างไว้ เช่น "ปล่อยเพื่อแนบเป็นไฟล์ส่งงาน" */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  if (!enabled) return <div className={className}>{children}</div>;

  return (
    <div
      className={`relative ${className}`}
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
