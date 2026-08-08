"use client";

import { useState } from "react";
import { X } from "lucide-react";

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
  const [open, setOpen] = useState<string | null>(null);
  if (urls.length === 0) return null;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => setOpen(url)}
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

      {open && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white"
            aria-label="ปิด"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={open}
            alt="รูปขยาย"
            className="max-h-full max-w-full rounded-(--radius) object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
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
}: {
  name: string;
  label?: string;
  accept?: string;
  multiple?: boolean;
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
        <span className="text-sm font-medium text-(--ink)">
          {label}
          {previews.length > 0 && ` (${previews.length})`}
        </span>
        <input
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            setPreviews(files.map((f) => URL.createObjectURL(f)));
          }}
          className="text-sm text-(--ink) file:mr-3 file:rounded-(--radius) file:border file:border-(--line) file:bg-(--bg-soft) file:px-3 file:py-1.5 file:text-sm"
        />
      </label>
    </div>
  );
}
