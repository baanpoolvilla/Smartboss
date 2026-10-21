"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, FileText, Loader2, Paperclip, X } from "lucide-react";

import { compressImage } from "@/modules/chat/lib/image-compress";
import { uploadFilesAction, type UploadedFile } from "../actions";
import { baht, receiptFlags, thaiDate, type AttachmentRole } from "../lib/types";

/**
 * แนบรูป/PDF — ย่อรูปในเครื่องก่อนส่ง (รูปมือถือ 3–5MB เหลือไม่กี่ร้อย KB)
 * ใบเสร็จ: ขึ้นสิ่งที่ระบบอ่านได้ (ยอด/วันที่/ร้าน) + ข้อเตือน (ซ้ำ/วันที่ไม่ตรง/เก่า/ดูผิดปกติ)
 */
export function FilePicker({
  role,
  files,
  onChange,
  label,
  hint,
  claimDate,
  today,
  maxAgeDays = 60,
  onAiRead,
}: {
  role: AttachmentRole;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  label: string;
  hint?: string;
  claimDate?: string;
  today?: string;
  maxAgeDays?: number;
  /** ใบเสร็จใบแรกที่อ่านยอด/วันที่ได้ — ให้ฟอร์มเติมช่องให้ (ถ้ายังว่าง) */
  onAiRead?: (f: UploadedFile) => void;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).slice(0, 10);
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("role", role);
      for (const f of picked) {
        if (f.type.startsWith("image/") && f.type !== "image/gif") {
          try {
            fd.append("files", (await compressImage(f)).full);
            continue;
          } catch {
            // ย่อไม่ได้ ส่งไฟล์เดิม
          }
        }
        fd.append("files", f);
      }
      const res = await uploadFilesAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChange([...files, ...res.files]);
      // ใบเสร็จทุกใบที่อ่านได้ — ฟอร์มเติมเป็นรายการละใบ
      if (onAiRead) for (const f of res.files) if (f.ai && (f.ai.amount || f.ai.date)) onAiRead(f);
    });
    if (pickRef.current) pickRef.current.value = "";
    if (camRef.current) camRef.current.value = "";
  }

  const isReceipt = role === "receipt" || role === "clearing";
  const isSlip = role === "slip";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-(--ink)">{label}</div>
          {hint && <div className="text-xs text-(--ink-soft)">{hint}</div>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => camRef.current?.click()}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm hover:bg-(--bg-soft) disabled:opacity-60"
          >
            <Camera className="h-4 w-4" aria-hidden="true" /> ถ่ายรูป
          </button>
          <button
            type="button"
            onClick={() => pickRef.current?.click()}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm hover:bg-(--bg-soft) disabled:opacity-60"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" /> เลือกไฟล์
          </button>
        </div>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} />
      <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => upload(e.target.files)} />

      {busy && (
        <div className="flex items-center gap-2 rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink-soft)">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> กำลังอัปโหลด{isReceipt ? " และอ่านใบเสร็จ…" : "…"}
        </div>
      )}
      {error && <div className="rounded-(--radius) bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      {files.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-2">
          {files.map((f, i) => {
            const flags = isSlip
              ? [...(f.duplicateOf ? [{ level: "block" as const, text: `สลิปนี้เคยใช้แล้วใน ${f.duplicateOf}` }] : []), ...(f.ai && !f.ai.isReceipt ? [{ level: "warn" as const, text: "ระบบอ่านแล้วไม่เหมือนสลิปโอน — ตรวจรูปอีกครั้ง" }] : [])]
              : receiptFlags(f, { claimDate: claimDate ?? today ?? "", today: today ?? "9999-12-31", maxAgeDays, duplicateOf: f.duplicateOf });
            return (
              <li key={f.sha256 + i} className="flex gap-3 rounded-(--radius) border border-(--line) bg-(--bg) p-2">
                <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0">
                  {f.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt={f.name} className="h-16 w-16 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-md bg-(--bg-soft)">
                      <FileText className="h-6 w-6 text-(--ink-soft)" aria-hidden="true" />
                    </span>
                  )}
                </a>
                <div className="min-w-0 flex-1 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate font-medium text-(--ink)">{f.name}</span>
                    <button type="button" aria-label={`เอา ${f.name} ออก`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="-m-1 rounded p-1 text-(--ink-soft) hover:bg-(--bg-soft)">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {(isReceipt || isSlip) && f.ai && (f.ai.amount || f.ai.date || f.ai.vendor) && (
                    <div className="mt-0.5 text-(--ink-soft)">
                      อ่านได้: {[f.ai.amount ? baht(f.ai.amount) : null, f.ai.date ? thaiDate(f.ai.date) : null, f.ai.vendor ? (isSlip ? `ผู้รับ ${f.ai.vendor}` : f.ai.vendor) : null, isSlip && f.ai.receiptNo ? `อ้างอิง ${f.ai.receiptNo}` : null].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {isReceipt && !f.ai && f.mime.startsWith("image/") && <div className="mt-0.5 text-(--ink-soft)">อ่านอัตโนมัติไม่ได้ — กรอกยอดเอง</div>}
                  {flags.map((fl, k) => (
                    <div key={k} className={`mt-0.5 font-medium ${fl.level === "block" ? "text-red-700" : "text-amber-700"}`}>
                      {fl.level === "block" ? "✕ " : "! "}
                      {fl.text}
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
