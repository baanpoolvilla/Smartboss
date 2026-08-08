"use client";

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
      <button
        type="submit"
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-(--radius) bg-[#2E7D32] text-base font-bold text-white hover:brightness-95"
      >
        <PlayCircle className="h-6 w-6" /> รับงาน — เริ่มดำเนินการ
      </button>
    </form>
  );
}

/**
 * ยืนยันงานเสร็จ — บังคับกรอกประมาณการค่าใช้จ่าย + แนบรูป
 * (ถ้ามีรูปจากช่างภายนอกแล้ว รูปแนบไม่บังคับ) ตรงกับ _showCompletionDialog เดิม
 */
export function CompleteJobButton({
  id,
  action,
  externalPhotoCount,
}: {
  id: string;
  action: Action;
  externalPhotoCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ name: string; price: string }[]>([
    { name: "", price: "" },
  ]);
  const [photoCount, setPhotoCount] = useState(0);

  const hasValidItem = items.some((i) => i.name.trim() !== "");
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
                disabled={!hasValidItem || !photoOk}
              >
                ยืนยันเสร็จ
              </Button>
            </>
          }
        >
          <form id="complete-wo-form" action={action} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm text-(--ink-soft)">
              {externalPhotoCount > 0
                ? "มีรูปจากช่างภายนอกแล้ว กรุณากรอกประมาณการค่าใช้จ่ายก่อนกดยืนยัน"
                : "กรุณากรอกประมาณการค่าใช้จ่ายและแนบรูปถ่ายก่อนกดยืนยัน"}
            </p>

            <p className="text-sm font-bold text-(--ink)">
              ประมาณการค่าใช้จ่าย *
            </p>
            {items.map((item, i) => (
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
            <button
              type="button"
              onClick={() => setItems([...items, { name: "", price: "" }])}
              className="inline-flex w-fit items-center gap-1 text-sm text-[#0F766E]"
            >
              <Plus className="h-4 w-4" /> เพิ่มรายการ
            </button>

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

/** กล่องเพิ่มความคิดเห็น + แนบรูป (ปุ่มรูป/กล้อง/ส่ง) */
export function CommentComposer({ action }: { action: Action }) {
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <form action={action} className="flex flex-col gap-2">
      {fileName && (
        <div
          className="flex items-center gap-2 rounded-(--radius) px-2.5 py-1.5 text-xs"
          style={{ backgroundColor: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1D4ED8" }}
        >
          <ImageIcon className="h-4 w-4" />
          รูปที่เลือก 1 รูป
          <span className="ml-auto truncate text-(--ink-soft)">{fileName}</span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-(--radius) text-(--ink-soft) hover:bg-(--bg-soft)"
          title="แนบรูป"
        >
          <ImageIcon
            className="h-5 w-5"
            style={fileName ? { color: "#2563EB" } : undefined}
          />
          <input
            type="file"
            name="image"
            accept="image/*"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <label
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-(--radius) text-(--ink-soft) hover:bg-(--bg-soft)"
          title="ถ่ายรูป"
        >
          <Camera className="h-5 w-5" />
          <input
            type="file"
            name="image"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <input
          name="content"
          maxLength={1000}
          placeholder="เพิ่มความคิดเห็น..."
          className="h-10 flex-1 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30"
        />
        <Button type="submit" size="icon" aria-label="ส่งความคิดเห็น">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
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
