"use client";

import { useEffect, useRef, useState } from "react";

import { WORK_ORDER_PREFILL_KEY, type WorkOrderPrefill } from "@/modules/maintenance/lib/report-prefill";

/**
 * เติมฟอร์มสร้างใบงานจากข้อความในรีพอต (ผู้ใช้ 2/11/2569)
 * ส่งข้อมูลมาทาง sessionStorage ไม่ใช่ URL เพราะเนื้อหายาว ๆ กับรายการรูปจะเกินขนาด URL
 * ฟอร์มเป็น server component ช่องเป็นแบบ uncontrolled จึงเติมค่าลงช่องตรง ๆ ได้
 */
export function ReportPrefill() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef(false);
  const [source, setSource] = useState<WorkOrderPrefill["source"] | null>(null);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    let data: WorkOrderPrefill | null = null;
    try {
      const raw = sessionStorage.getItem(WORK_ORDER_PREFILL_KEY);
      sessionStorage.removeItem(WORK_ORDER_PREFILL_KEY);
      data = raw ? (JSON.parse(raw) as WorkOrderPrefill) : null;
    } catch {
      return;
    }
    const form = anchorRef.current?.closest("form");
    if (!data || !form) return;
    const title = form.querySelector<HTMLInputElement>('input[name="title"]');
    const description = form.querySelector<HTMLTextAreaElement>('textarea[name="description"]');
    if (title) title.value = data.title;
    if (description) description.value = data.description;
    // ตั้งค่าใน effect ครั้งเดียวตอนเปิดหน้า — ข้อมูลอยู่ใน sessionStorage อ่านตอนเรนเดอร์บนเซิร์ฟเวอร์ไม่ได้
    setSource(data.source);

    const images = data.images;
    if (images.length === 0) return;
    void (async () => {
      // ดึงไม่ได้ก็ข้ามรูปนั้น ไม่ล้มทั้งหมด
      const files = await Promise.all(
        images.map(async (img) => {
          try {
            const res = await fetch(img.url);
            if (!res.ok) return null;
            const blob = await res.blob();
            return new File([blob], img.name || "รูปจากรีพอต", { type: img.mime || blob.type });
          } catch {
            return null;
          }
        })
      );
      const input = form.querySelector<HTMLInputElement>('input[type="file"][name="photos"]');
      const found = files.filter((f): f is File => f !== null);
      if (!input || found.length === 0) return;
      const transfer = new DataTransfer();
      for (const f of found) transfer.items.add(f);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })();
  }, []);

  return (
    <span ref={anchorRef} className="contents">
      {source && (
        <>
          <input type="hidden" name="sourceLabel" value={source.label} />
          <input type="hidden" name="sourceLink" value={source.link} />
        </>
      )}
    </span>
  );
}
