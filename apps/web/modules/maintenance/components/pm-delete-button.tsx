"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

/**
 * ลบแผน PM — ถามก่อนทุกครั้ง (ผู้ใช้ 5/11/2569 "กดลบแล้วลบเลย อยากให้ถามก่อน")
 * บอกผลให้ชัด: ใบรอบที่เปิดอยู่ถูกยกเลิกไปด้วย และย้อนกลับไม่ได้
 */
export function PmDeleteButton({
  id,
  title,
  openRounds,
  action,
}: {
  id: string;
  title: string;
  /** จำนวนใบรอบที่ยังเปิดอยู่ของแผนนี้ */
  openRounds: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-[#DC2626]" onClick={() => setOpen(true)} data-testid="pm-delete">
        ลบ
      </Button>
      {open && (
        <Modal
          title="ลบแผน PM"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <form action={action}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="danger" size="sm" className="gap-1" data-testid="pm-delete-confirm">
                  <Trash2 className="h-4 w-4" /> ลบแผน
                </Button>
              </form>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-sm text-(--ink)" data-testid="pm-delete-message">
            <p>
              ต้องการลบแผน <span className="font-semibold">&quot;{title}&quot;</span> หรือไม่?
            </p>
            <ul className="list-disc space-y-1 pl-5 text-(--ink-soft)">
              {openRounds > 0 && <li className="text-[#B91C1C]">{`ใบรอบที่เปิดอยู่ ${openRounds} ใบจะถูกยกเลิกไปด้วย`}</li>}
              <li>ระบบจะไม่เปิดใบรอบใหม่ของแผนนี้อีก</li>
              <li>ใบที่ปิดไปแล้วยังอยู่</li>
              <li>คะแนนที่โดนหักไปแล้วยังอยู่ ถ้าไม่ควรโดนให้กด &quot;ขอแก้ไข&quot; ที่หน้าคะแนน</li>
              <li>ลบแล้วย้อนกลับไม่ได้</li>
            </ul>
          </div>
        </Modal>
      )}
    </>
  );
}
