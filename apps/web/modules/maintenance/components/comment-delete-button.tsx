"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

/**
 * ลบความเห็นทีละอัน — ถามยืนยันก่อนเสมอ
 *
 * ปุ่มเล็กและกลืนไปกับพื้นหลังจนกว่าจะเอาเมาส์ไปวาง เพราะการลบเป็นสิ่งที่
 * นาน ๆ ทำที ถ้าเด่นเท่าปุ่มอื่นจะกดโดนโดยไม่ตั้งใจบนมือถือ
 *
 * ⚠ PO: รูปที่แนบมาถูกลบออกจาก storage ด้วย ไม่ใช่แค่ซ่อนแถว — กู้ไม่ได้
 * ใบงาน (`logged`): มีบันทึกการลบในความคิดเห็น รูปเก็บไว้ให้คนจัดการใบงานดูย้อนหลัง
 * `imageUrl` = ลบเฉพาะรูปนั้น ไม่ใช่ทั้งความคิดเห็น
 */
export function CommentDeleteButton({
  commentId,
  action,
  hasImages,
  imageUrl,
  logged = false,
}: {
  commentId: string;
  action: (formData: FormData) => void | Promise<void>;
  hasImages: boolean;
  imageUrl?: string;
  logged?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={imageUrl ? "ลบรูปนี้" : "ลบความเห็นนี้"}
        className="shrink-0 rounded p-1 text-(--ink-soft) opacity-50 hover:bg-[#FEF2F2] hover:text-[#DC2626] hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <Modal
          title={imageUrl ? "ลบรูป" : "ลบความเห็น"}
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
                <input type="hidden" name="commentId" value={commentId} />
                {imageUrl && <input type="hidden" name="imageUrl" value={imageUrl} />}
                <Button type="submit" variant="danger" size="sm">
                  ลบ
                </Button>
              </form>
            </>
          }
        >
          {logged ? (
            <p className="text-sm text-(--ink)">
              {imageUrl ? "ต้องการลบรูปนี้หรือไม่?" : "ต้องการลบความเห็นนี้หรือไม่?"} ระบบจะบันทึกไว้ในความคิดเห็นว่าใครลบ เมื่อไหร่
            </p>
          ) : (
            <p className="text-sm text-(--ink)">
              ต้องการลบความเห็นนี้หรือไม่?
              {hasImages && " รูปที่แนบมาจะถูกลบออกจากระบบด้วย"}
              {"\n\n"}การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
