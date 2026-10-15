"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";

import { Modal } from "./dialog";
import { MultiPicker, type PickOption } from "./multi-picker";

/**
 * ปุ่ม "แก้" ข้างแถว "บ้าน" ในหน้ารายละเอียดใบงาน — เลือกบ้านผิดตอนเปิดใบ แก้ได้ไม่ต้องสร้างใบใหม่
 * ตัวเช็คสิทธิ์/เงื่อนไขอยู่ที่ updateWorkOrderPropertiesAction (หน้านี้แค่ซ่อนปุ่ม)
 */
export function EditWorkOrderProperties({
  options,
  selected,
  action,
}: {
  options: PickOption[];
  selected: string[];
  action: (formData: FormData) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = "wo-edit-properties";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="ml-2 inline-flex items-center gap-1 rounded-(--radius) px-1.5 py-0.5 text-xs font-normal text-[#0F766E] hover:bg-(--bg-soft)"
      >
        <Pencil className="h-3.5 w-3.5" /> แก้
      </button>
      {open && (
        <Modal
          title="แก้บ้านของใบงาน"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" form={formId} size="sm" disabled={pending}>
                {pending ? "กำลังบันทึก..." : "บันทึก"}
              </Button>
            </>
          }
        >
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(async () => {
                const r = await action(fd);
                if (r.error) setError(r.error);
                else {
                  setOpen(false);
                  router.refresh();
                }
              });
            }}
          >
            <MultiPicker
              name="propertyIds"
              title="เลือกบ้าน"
              heading="บ้าน *"
              emptyText="กรุณาเลือกอย่างน้อย 1 บ้าน"
              addLabel="เลือกบ้าน"
              options={options}
              defaultSelected={selected}
            />
            <p className="text-xs text-(--ink-soft)">บันทึกแล้วจะมีข้อความในความคิดเห็นว่าเปลี่ยนจากบ้านไหนเป็นบ้านไหน</p>
            {error && <p className="text-sm text-[#DC2626]">{error}</p>}
          </form>
        </Modal>
      )}
    </>
  );
}
