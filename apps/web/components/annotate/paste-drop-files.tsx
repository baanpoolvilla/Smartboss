"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { filesFromDataTransfer } from "@/lib/annotate/annotate";

/**
 * ครอบส่วนไหนก็ได้ที่มี <input type="file"> อยู่ข้างใน — วางรูปที่แคป (Ctrl+V) หรือลากไฟล์มาวาง
 * ในกรอบนี้ = เหมือนกดเลือกไฟล์ในช่องนั้นเอง (ใส่ไฟล์ลง input แล้วยิง change) handler เดิมของ
 * แต่ละฟอร์มทำงานต่อได้เลยโดยไม่ต้องแก้
 *
 * - ช่องที่ส่งไปกับฟอร์ม (มี name) → ต่อท้ายไฟล์ที่เลือกไว้แล้ว ไม่ทับของเดิม
 * - ช่องที่อัปโหลดทันทีตอนเลือก (ไม่มี name) → ใส่แค่ไฟล์ใหม่
 * - มีหลายช่อง → เลือกช่องที่รับไฟล์ชนิดนั้นได้ ช่องคลังรูปก่อนช่องกล้อง (capture)
 * - วางด้วย Ctrl+V ได้เมื่อโฟกัสอยู่ในกรอบ (คลิกตรงไหนในกรอบก่อนก็ได้)
 */
export function PasteDropFiles({
  children,
  className = "",
  label = "ปล่อยเพื่อแนบไฟล์",
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** ข้อความตอนลากไฟล์ค้างไว้เหนือกรอบ */
  label?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  /** ส่งไฟล์เข้า input ในกรอบ — false = ในกรอบไม่มีช่องรับไฟล์ (ปล่อยให้ข้างนอกจัดการ) */
  function deliver(files: File[]): boolean {
    const root = ref.current;
    if (!root) return false;
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((i) => !i.disabled);
    if (inputs.length === 0) return false;
    const fitsAll = (i: HTMLInputElement) => files.every((f) => accepts(i.accept, f));
    const target = inputs.find((i) => !i.hasAttribute("capture") && fitsAll(i)) ?? inputs.find(fitsAll);
    if (!target) {
      toast.error("ไฟล์ชนิดนี้แนบตรงนี้ไม่ได้");
      return true;
    }
    const dt = new DataTransfer();
    if (target.multiple && target.name) for (const f of Array.from(target.files ?? [])) dt.items.add(f);
    for (const f of target.multiple ? files : files.slice(0, 1)) dt.items.add(f);
    target.files = dt.files;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (disabled) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      // คลิกพื้นที่ว่างในกรอบแล้วโฟกัสอยู่ในกรอบ — Ctrl+V จะได้มาถึงตรงนี้
      tabIndex={-1}
      className={`relative outline-none ${className}`}
      onPaste={(e) => {
        if (e.defaultPrevented) return; // กรอบข้างในรับไปแล้ว (ครอบซ้อนกัน)
        const target = e.target as HTMLElement;
        const files = filesFromDataTransfer(e.clipboardData);
        if (files.length === 0) return; // วางข้อความตามปกติ
        // ช่องพิมพ์ที่จัดการรูปเองอยู่แล้ว (เช่น ช่องข้อความแบบ rich text) ไม่ต้องแย่ง
        if (target.closest("[data-own-paste]")) return;
        if (deliver(files)) e.preventDefault();
      }}
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
        depth.current = 0;
        setOver(false);
        const files = filesFromDataTransfer(e.dataTransfer);
        if (files.length === 0) return;
        if (deliver(files)) {
          e.preventDefault();
          e.stopPropagation();
        }
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

/** เทียบไฟล์กับ accept ของ input แบบเดียวกับ browser ("image/*", ".pdf", "video/mp4") */
function accepts(accept: string, file: File): boolean {
  const rules = accept
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return rules.some((r) => (r.startsWith(".") ? name.endsWith(r) : r.endsWith("/*") ? type.startsWith(r.slice(0, -1)) : type === r));
}
