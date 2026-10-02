"use client";

import { SubmitButton } from "./submit-button";

import { useRef, useState } from "react";
import { Camera, ClipboardPaste } from "lucide-react";

import { FORM_UPLOAD_MAX_BYTES, firstTooLarge, totalTooLargeMessage } from "@/lib/file-limits";
import { hasClipboardText } from "@/lib/annotate/annotate";

/** ตัดข้อความที่ 500 ตัว — ต้องตรงกับ NOTE_MAX ฝั่งเซิร์ฟเวอร์ */
const NOTE_MAX = 500;

/**
 * ฟอร์มส่งรูป/ข้อความของช่างภายนอก
 *
 * เป็น client component เพราะต้องรับการ **วางรูปจากคลิปบอร์ด** (Ctrl+V) ซึ่ง
 * ต้องดักอีเวนต์ในเบราว์เซอร์ — ช่างมักแคปหน้าจอหรือก๊อปรูปจากแชตมาวาง
 * มากกว่าจะกดถ่ายใหม่ ตอนที่ยังไม่มีทางวาง เขาต้องเซฟลงเครื่องก่อนแล้วค่อยเลือกไฟล์
 *
 * ⚠ ตัวนับ/ตัดความยาวที่นี่เป็นแค่ความสะดวก — หน้านี้เปิดสาธารณะด้วย token
 * ฝั่งเซิร์ฟเวอร์จึงตัดซ้ำเสมอ ไม่เชื่อค่าที่ส่งมา
 */
export function ExternalUploadForm({
  action,
  remaining,
}: {
  action: (formData: FormData) => void | Promise<void>;
  remaining: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");
  const [pasted, setPasted] = useState(0);
  // หน้านี้เปิดสาธารณะ อยู่นอก Shell (ไม่มีกล่องเด้ง/ตัวกันไฟล์ใหญ่ของ Shell) — เตือนในฟอร์มเอง รูปแบบเดียวกัน
  const [sizeError, setSizeError] = useState<string | null>(null);

  function checkInput(input: HTMLInputElement) {
    const message = firstTooLarge(Array.from(input.files ?? []), FORM_UPLOAD_MAX_BYTES);
    setSizeError(message);
    if (message) input.value = "";
    return !message;
  }

  function checkTotal(form: HTMLFormElement): string | null {
    const files = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]')).flatMap((i) => Array.from(i.files ?? []));
    const total = files.reduce((n, f) => n + f.size, 0);
    return firstTooLarge(files, FORM_UPLOAD_MAX_BYTES) ?? (total > FORM_UPLOAD_MAX_BYTES ? totalTooLargeMessage(total, FORM_UPLOAD_MAX_BYTES) : null);
  }

  /** เอาไฟล์ที่วางมาต่อเข้า input เดิม — DataTransfer เป็นทางเดียวที่ตั้ง input.files ได้ */
  function onPaste(e: React.ClipboardEvent) {
    if (hasClipboardText(e.clipboardData)) return; // ตารางจาก Excel ฯลฯ = วางเป็นข้อความ
    const images = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (images.length === 0) return;
    e.preventDefault();

    const input = inputRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    for (const f of input.files ?? []) dt.items.add(f);
    for (const f of images) {
      if (dt.items.length >= remaining) break;
      dt.items.add(f);
    }
    input.files = dt.files;
    if (!checkInput(input)) {
      setCount(0);
      return;
    }
    setCount(dt.files.length);
    setPasted((n) => n + images.length);
  }

  const nothingToSend = count === 0 && note.trim() === "";

  return (
    <form
      action={action}
      onPaste={onPaste}
      onSubmit={(e) => {
        const message = checkTotal(e.currentTarget);
        if (!message) return;
        e.preventDefault();
        setSizeError(message);
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-(--radius) border border-[#0D9488] py-2.5 text-sm text-[#0F766E]">
        <Camera className="h-4 w-4" /> ถ่ายรูป
        <input
          type="file"
          name="photos"
          accept="image/*"
          capture="environment"
          onChange={(e) => checkInput(e.currentTarget)}
          className="hidden"
        />
      </label>

      <input
        ref={inputRef}
        type="file"
        name="photos"
        multiple
        accept="image/*"
        onChange={(e) => setCount(checkInput(e.currentTarget) ? (e.currentTarget.files?.length ?? 0) : 0)}
        className="text-sm text-(--ink) file:mr-3 file:rounded-(--radius) file:border file:border-(--line) file:bg-(--bg-soft) file:px-3 file:py-1.5 file:text-sm"
      />

      <p className="inline-flex items-center gap-1.5 text-xs text-(--ink-soft)">
        <ClipboardPaste className="h-3.5 w-3.5" />
        ก๊อปรูปมาแล้วกด Ctrl+V วางตรงนี้ได้เลย
        {pasted > 0 && <span className="text-[#0F766E]">— วางแล้ว {pasted} รูป</span>}
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-(--ink)">
          ข้อความถึงผู้ดูแล (ไม่บังคับ)
        </span>
        <textarea
          name="note"
          rows={3}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น เปลี่ยนคอมเพรสเซอร์แล้ว เหลือรอสั่งอะไหล่อีก 1 ชิ้น"
          className="rounded-(--radius) border border-(--line) bg-(--bg) p-2.5 text-sm text-(--ink)"
        />
        <span className="self-end text-xs text-(--ink-soft)">
          {note.length}/{NOTE_MAX}
        </span>
      </label>

      {sizeError && (
        <p role="alert" className="rounded-(--radius) bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)">
          {sizeError}
        </p>
      )}

      <p className="text-xs text-(--ink-soft)">
        เลือกได้อีกสูงสุด {remaining} รูป
        {count > 0 && ` · เลือกไว้ ${count} รูป`}
      </p>

      <SubmitButton disabled={nothingToSend} pendingText="กำลังส่ง…">
        {count === 0 && note.trim() !== "" ? "ส่งข้อความ" : "ส่งรูป"}
      </SubmitButton>
      {nothingToSend && (
        <p className="text-xs text-(--ink-soft)">
          แนบรูปหรือพิมพ์ข้อความอย่างน้อยอย่างใดอย่างหนึ่ง
        </p>
      )}
    </form>
  );
}
