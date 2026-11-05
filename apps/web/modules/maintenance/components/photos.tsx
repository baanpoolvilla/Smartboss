"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Lightbox } from "@/modules/chat/components/lightbox";

/**
 * แถวรูปเลื่อนแนวนอน + แตะเพื่อดูเต็มจอ
 * ตรงกับ SizedBox(height:150) + ListView.horizontal + _showFullImage ของเดิม
 */
export function PhotoStrip({
  urls,
  size = 150,
}: {
  urls: string[];
  size?: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (urls.length === 0) return null;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => setOpen(i)}
            className="shrink-0 overflow-hidden rounded-(--radius) border border-(--line)"
            style={{ width: size, height: size }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`รูปที่ ${i + 1}`}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      {/* หน้าดูรูปตัวเดียวกับแชท/รายงาน — เต็มจอ ปัดซ้ายขวาเปลี่ยนรูป ปัดขึ้น/ลงเพื่อปิด ดาวน์โหลดได้ */}
      {open !== null && (
        <Lightbox
          onTop
          items={urls.map((url, i) => ({ url, name: `รูปที่ ${i + 1}`, mime: "image/jpeg", size: 0, kind: "image" as const }))}
          index={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** พรีวิวไฟล์ที่เพิ่งเลือกในฟอร์ม (Image.memory + ปุ่มกากบาทลบ) */
export function FilePreviewInput({
  name,
  label = "แนบรูปภาพ",
  accept = "image/*",
  multiple = true,
  attachStyle = false,
}: {
  name: string;
  label?: string;
  accept?: string;
  multiple?: boolean;
  /** ปุ่มเส้นประแบบหน้าสร้างงาน แทนช่องเลือกไฟล์ของเบราว์เซอร์ — ไม่ส่ง = แบบเดิม */
  attachStyle?: boolean;
}) {
  const [previews, setPreviews] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-2">
      {previews.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {previews.map((src, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={i}
              src={src}
              alt={`พรีวิว ${i + 1}`}
              className="h-[100px] w-[100px] shrink-0 rounded-(--radius) border border-(--line) object-cover"
            />
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1.5">
        <span className={attachStyle ? "text-xs text-(--ink-soft)" : "text-sm font-medium text-(--ink)"}>
          {label}
          {previews.length > 0 && ` (${previews.length})`}
        </span>
        {attachStyle && (
          <span className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-(--line) px-3 py-1.5 text-sm text-(--ink-soft) hover:border-(--app) hover:text-(--ink)">
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            แนบรูปภาพ
          </span>
        )}
        <input
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            setPreviews(files.map((f) => URL.createObjectURL(f)));
          }}
          className={attachStyle ? "sr-only" : "text-sm text-(--ink) file:mr-3 file:rounded-(--radius) file:border file:border-(--line) file:bg-(--bg-soft) file:px-3 file:py-1.5 file:text-sm"}
        />
      </label>
      {attachStyle && <p className="text-[11px] text-(--ink-soft)">หรือแคปหน้าจอ/คัดลอกรูปแล้วกด Ctrl+V วางในฟอร์มนี้ได้เลย</p>}
    </div>
  );
}
