"use client";

import { SubmitButton } from "./submit-button";

import { useState } from "react";
import {
  CheckCircle2,
  PlayCircle,
  Camera,
  Plus,
  MinusCircle,
  Trash2,
  Link2,
  Copy,
  Image as ImageIcon,
  Send,
  X,
} from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Card } from "@smartboss/ui/components/card";
import { Modal } from "./dialog";
import { CommentTextarea } from "./comment-textarea";
import { PasteDropFiles } from "@/components/annotate/paste-drop-files";

type Action = (formData: FormData) => void | Promise<void>;

/** ปุ่ม "รับงาน — เริ่มดำเนินการ" (เต็มความกว้าง สูง 52 สีเขียว) */
export function StartJobButton({
  id,
  action,
}: {
  id: string;
  action: Action;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="in_progress" />
      <SubmitButton
        raw
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-(--radius) bg-[#2E7D32] text-base font-bold text-white hover:brightness-95 disabled:opacity-60"
      >
        <PlayCircle className="h-6 w-6" /> รับงาน — เริ่มดำเนินการ
      </SubmitButton>
    </form>
  );
}

/**
 * ยืนยันงานเสร็จ — บังคับกรอกประมาณการค่าใช้จ่าย + แนบรูป
 * (ถ้ามีรูปจากช่างภายนอกแล้ว รูปแนบไม่บังคับ) ตรงกับ _showCompletionDialog เดิม
 *
 * `requiresExpense = false` (งานที่จ้างเหมารายปีไว้แล้ว) จะไม่ถามค่าใช้จ่ายเลย
 * — บังคับกรอกทั้งที่ไม่มีอะไรให้กรอก คนจะใส่ 0 เพื่อให้ผ่าน แล้วรายงานจะเพี้ยน
 * รูปยังบังคับเหมือนเดิม เพราะเป็นหลักฐานว่าทำจริง คนละเรื่องกับเงิน
 */
export function CompleteJobButton({
  id,
  action,
  externalPhotoCount,
  requiresExpense = true,
}: {
  id: string;
  action: Action;
  externalPhotoCount: number;
  requiresExpense?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ name: string; price: string }[]>([
    { name: "", price: "" },
  ]);
  const [photoCount, setPhotoCount] = useState(0);
  // อัปโหลดรูปหลังแก้ใช้เวลา — ล็อกปุ่มไว้ ไม่งั้นกดซ้ำแล้วรูปถูกแนบซ้ำ
  // (ปุ่มอยู่นอก <form> ใช้ useFormStatus ไม่ได้)
  const [submitting, setSubmitting] = useState(false);
  const submit = async (fd: FormData) => {
    setSubmitting(true);
    try {
      await action(fd);
    } finally {
      setSubmitting(false);
    }
  };

  const hasValidItem = !requiresExpense || items.some((i) => i.name.trim() !== "");
  const photoOk = photoCount > 0 || externalPhotoCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-(--radius) bg-[#2E7D32] text-base font-bold text-white hover:brightness-95"
      >
        <CheckCircle2 className="h-6 w-6" /> ยืนยันงานเสร็จสิ้น
      </button>

      {open && (
        <Modal
          title="ยืนยันทำเสร็จแล้ว"
          wide
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="submit"
                form="complete-wo-form"
                size="sm"
                disabled={!hasValidItem || !photoOk || submitting}
              >
                {submitting ? "กำลังบันทึก…" : "ยืนยันเสร็จ"}
              </Button>
            </>
          }
        >
          <PasteDropFiles label="ปล่อยเพื่อแนบรูปหลังซ่อม">
          <form id="complete-wo-form" action={submit} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm text-(--ink-soft)">
              {!requiresExpense
                ? "งานนี้ตั้งไว้ว่าไม่มีค่าใช้จ่าย — แนบรูปถ่ายแล้วกดยืนยันได้เลย"
                : externalPhotoCount > 0
                  ? "มีรูปจากช่างภายนอกแล้ว กรุณากรอกประมาณการค่าใช้จ่ายก่อนกดยืนยัน"
                  : "กรุณากรอกประมาณการค่าใช้จ่ายและแนบรูปถ่ายก่อนกดยืนยัน"}
            </p>
            {requiresExpense && (
              <div>
                <p className="text-sm font-bold text-(--ink)">ค่าใช้จ่าย *</p>
                {/* ราคาที่ใส่ตรงนี้ลงเป็นค่าใช้จ่ายของใบงานทันที (recordEstimateAsExpense) — บอกให้รู้ว่าไม่ต้องไปลงซ้ำ */}
                <p className="text-xs text-(--ink-soft)">
                  ใส่ราคา = บันทึกเป็นค่าใช้จ่ายของใบงานนี้ทันที ไม่ต้องไปลงซ้ำ · ไม่มีค่าใช้จ่ายใส่ 0 · ยังไม่รู้ราคาเว้นว่างไว้ให้ผู้จัดการลง
                </p>
              </div>
            )}
            {requiresExpense && items.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <input
                  name="itemName"
                  value={item.name}
                  onChange={(e) =>
                    setItems(
                      items.map((it, j) =>
                        j === i ? { ...it, name: e.target.value } : it
                      )
                    )
                  }
                  placeholder="เช่น ค่าวัสดุ, ค่าแรงช่าง"
                  aria-label={`รายการที่ ${i + 1}`}
                  className="h-10 flex-3 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
                />
                <input
                  name="itemPrice"
                  value={item.price}
                  inputMode="decimal"
                  onChange={(e) =>
                    setItems(
                      items.map((it, j) =>
                        j === i ? { ...it, price: e.target.value } : it
                      )
                    )
                  }
                  placeholder="฿ ราคา"
                  aria-label="ราคา"
                  className="h-10 flex-2 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
                />
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                    aria-label="ลบรายการ"
                    className="mt-2 text-[#DC2626]"
                  >
                    <MinusCircle className="h-5 w-5" />
                  </button>
                )}
              </div>
            ))}
            {requiresExpense && (
              <button
                type="button"
                onClick={() => setItems([...items, { name: "", price: "" }])}
                className="inline-flex w-fit items-center gap-1 text-sm text-[#0F766E]"
              >
                <Plus className="h-4 w-4" /> เพิ่มรายการ
              </button>
            )}

            {externalPhotoCount > 0 && (
              <div
                className="flex items-center gap-2 rounded-(--radius) p-2.5 text-sm"
                style={{ backgroundColor: "#F0FDF4", border: "1px solid #BBF7D0", color: "#166534" }}
              >
                <CheckCircle2 className="h-4 w-4" />
                ใช้รูปจากช่างภายนอก {externalPhotoCount} รูปเป็นหลักฐานปิดงานได้
              </div>
            )}

            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-(--radius) border border-[#0D9488] px-3 py-2 text-sm text-[#0F766E]">
              <Camera className="h-4 w-4" />
              {photoCount === 0
                ? externalPhotoCount > 0
                  ? "แนบรูปเพิ่ม (ไม่บังคับ)"
                  : "แนบรูปภาพหลังแก้ไข *"
                : `เพิ่มรูป (${photoCount})`}
              <input
                type="file"
                name="afterPhotos"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
              />
            </label>

            {!photoOk && (
              <p className="text-xs text-[#DC2626]">
                * จำเป็นต้องแนบรูปถ่ายอย่างน้อย 1 รูป
              </p>
            )}
          </form>
          </PasteDropFiles>
        </Modal>
      )}
    </>
  );
}

const STATUSES = [
  { value: "open", label: "เปิด", color: "#2563EB" },
  { value: "in_progress", label: "กำลังดำเนินการ", color: "#EA580C" },
  { value: "completed", label: "เสร็จแล้ว", color: "#16A34A" },
  { value: "cancelled", label: "ยกเลิก", color: "#6B7280" },
];

/** เปลี่ยนสถานะ (SimpleDialog รายการ 4 สถานะ) — เฉพาะ Super Admin */
export function ChangeStatusButton({
  id,
  current,
  action,
}: {
  id: string;
  current: string;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="w-full">
        เปลี่ยนสถานะ
      </Button>
      {open && (
        <Modal title="เปลี่ยนสถานะ" onClose={() => setOpen(false)}>
          <div className="flex flex-col">
            {STATUSES.map((s) => (
              <form key={s.value} action={action}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value={s.value} />
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 border-b border-(--line) py-3 text-left text-sm last:border-0"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span
                    className="text-(--ink)"
                    style={{ fontWeight: current === s.value ? 700 : 400 }}
                  >
                    {s.label}
                  </span>
                  {current === s.value && (
                    <CheckCircle2 className="ml-auto h-4 w-4 text-(--ink-soft)" />
                  )}
                </button>
              </form>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/** ยืนยันลบ (AlertDialog แดง) */
export function DeleteButton({
  id,
  action,
  title,
  label = "ลบใบงาน",
  message,
}: {
  id: string;
  action: Action;
  title: string;
  label?: string;
  message?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-(--radius) border border-[#DC2626] px-4 py-2.5 text-sm text-[#DC2626] hover:bg-[#FEF2F2]"
      >
        <Trash2 className="h-4 w-4" /> {label}
      </button>
      {open && (
        <Modal
          title={label}
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                ยกเลิก
              </Button>
              <form action={action}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="danger" size="sm">
                  ลบ
                </Button>
              </form>
            </>
          }
        >
          <p className="text-sm text-(--ink)">
            {message ??
              `ต้องการลบ "${title}" หรือไม่?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`}
          </p>
        </Modal>
      )}
    </>
  );
}

/** การ์ด "ให้ช่างภายนอกส่งรูป" + ลิงก์ที่คัดลอกได้ */
export function ExternalUploadCard({
  id,
  action,
  currentUrl,
}: {
  id: string;
  action: Action;
  currentUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Link2 className="h-5 w-5 shrink-0" style={{ color: "#0D9488" }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-(--ink)">
            ให้ช่างภายนอกส่งรูป
          </p>
          <p className="text-xs text-(--ink-soft)">
            ช่างเปิดลิงก์และลงรูปได้โดยไม่ต้อง Login
          </p>
        </div>
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm">
            สร้างลิงก์
          </Button>
        </form>
      </div>

      {currentUrl && (
        <div className="mt-3">
          <p className="break-all rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-xs text-(--ink-soft)">
            {currentUrl}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(currentUrl);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <Copy className="h-4 w-4" /> คัดลอกลิงก์
            </Button>
            <span className="text-xs text-(--ink-soft)">
              {copied
                ? "คัดลอกลิงก์แล้ว"
                : "ลิงก์ใช้ได้ 7 วัน — การสร้างลิงก์ใหม่จะยกเลิกลิงก์เดิม"}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/** รูปต่อความคิดเห็นสูงสุด — ตรงกับฝั่งเซิร์ฟเวอร์ (addCommentAction / addPoCommentAction) */
const MAX_COMMENT_IMAGES = 10;

/**
 * กล่องเพิ่มความคิดเห็น + แนบรูป (ปุ่มรูป/กล้อง/ส่ง)
 *
 * รูปที่เลือกเก็บใน state แล้วแนบตอนกดส่ง ("images") — เลือกเพิ่มกี่ครั้งก็ต่อท้าย ไม่ทับรูปเดิม
 * (เดิมเป็น <input> สองช่องชื่อ "image" เลือกใหม่ = แทนรูปเดิม และเซิร์ฟเวอร์อ่านแค่ช่องแรก
 * ถ่ายจากกล้องเลยหายเงียบ) · กด ✕ บนรูปเพื่อเอาออกก่อนส่ง · วาง/ลากรูปมาก็ต่อท้ายเหมือนกัน
 */
export function CommentComposer({ action, mentionPeople }: { action: Action; mentionPeople?: { id: string; name: string }[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  function add(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    if (picked.length === 0) return;
    const room = MAX_COMMENT_IMAGES - files.length;
    const take = picked.slice(0, Math.max(0, room));
    setFiles((prev) => [...prev, ...take]);
    setPreviews((prev) => [...prev, ...take.map((f) => URL.createObjectURL(f))]);
  }

  function removeAt(i: number) {
    URL.revokeObjectURL(previews[i]!);
    setFiles((prev) => prev.filter((_, j) => j !== i));
    setPreviews((prev) => prev.filter((_, j) => j !== i));
  }

  function clear() {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles([]);
    setPreviews([]);
  }

  const full = files.length >= MAX_COMMENT_IMAGES;

  return (
    <PasteDropFiles label="ปล่อยเพื่อแนบรูป">
    <form
      action={(fd) => {
        for (const f of files) fd.append("images", f);
        clear();
        return action(fd);
      }}
      className="flex flex-col gap-2"
    >
      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            {previews.map((url, i) => (
              <div key={url} className="relative h-16 w-16 overflow-hidden rounded-(--radius) border border-(--line)">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`รูปที่ ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`เอารูปที่ ${i + 1} ออก`}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <span className="text-xs text-(--ink-soft)">
            รูปที่เลือก {files.length} รูป{full ? ` (ครบ ${MAX_COMMENT_IMAGES} รูปแล้ว)` : ""} · กด ✕ เพื่อเอาออก
          </span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label
          className={`flex h-10 w-10 items-center justify-center rounded-(--radius) text-(--ink-soft) hover:bg-(--bg-soft) ${full ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
          title="แนบรูป (เลือกได้หลายรูป)"
        >
          <ImageIcon
            className="h-5 w-5"
            style={files.length > 0 ? { color: "#2563EB" } : undefined}
          />
          {/* ไม่มี name — รูปไปกับฟอร์มผ่าน state ตอนส่ง (ดู action ข้างบน) */}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={full}
            className="hidden"
            onChange={(e) => {
              add(e.target.files);
              e.target.value = ""; // เลือกรูปเดิมซ้ำได้
            }}
          />
        </label>
        <label
          className={`flex h-10 w-10 items-center justify-center rounded-(--radius) text-(--ink-soft) hover:bg-(--bg-soft) ${full ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
          title="ถ่ายรูป"
        >
          <Camera className="h-5 w-5" />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={full}
            className="hidden"
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <div className="flex-1">
          <CommentTextarea
            placeholder={mentionPeople?.length ? "เพิ่มความคิดเห็น... พิมพ์ @ เพื่อแท็กคน (Shift+Enter ขึ้นบรรทัดใหม่)" : "เพิ่มความคิดเห็น... (Shift+Enter ขึ้นบรรทัดใหม่)"}
            ariaLabel="เพิ่มความคิดเห็น"
            mentionPeople={mentionPeople}
          />
        </div>
        <SubmitButton size="icon" aria-label="ส่งความคิดเห็น" pendingText={<Send className="h-4 w-4 opacity-50" />}>
          <Send className="h-4 w-4" />
        </SubmitButton>
      </div>
    </form>
    </PasteDropFiles>
  );
}

/** ปุ่มกากบาทปิดแถบ (ใช้ในหน้ารายการที่มีตัวกรอง) */
export function ClearFilterLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center gap-1 rounded-[10px] px-2 py-1.5 text-sm text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
    >
      <X className="h-4 w-4" /> ล้างตัวกรอง
    </a>
  );
}
