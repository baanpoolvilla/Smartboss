"use client";

import { useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import type { Site } from "@/modules/hr/lib/api";
import { createSiteAction, updateSiteAction } from "../../actions";

/**
 * ดึงพิกัดเครื่องที่ใช้อยู่ แล้วยัดลงช่อง latitude/longitude ของฟอร์มที่ครอบปุ่มนี้
 *
 * คนตั้งค่ามักยืนอยู่ที่สถานที่นั้นจริง ๆ ตอนกรอก — การให้ไปเปิดแผนที่หาพิกัดเอง
 * แล้วพิมพ์ทศนิยม 6 ตำแหน่งกลับมาคือวิธีที่พิมพ์ผิดง่ายที่สุดเท่าที่จะเป็นได้
 *
 * เขียนค่าผ่าน native input setter เพราะช่องเป็น uncontrolled (defaultValue) —
 * การ set `.value` ตรง ๆ ใช้ได้ แต่ต้อง dispatch input event ให้ React รู้ด้วย
 * เผื่อวันหน้ามีใครเปลี่ยนเป็น controlled
 */
function useFillPosition(formRef: React.RefObject<HTMLFormElement | null>) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const fill = () => {
    if (!navigator.geolocation) {
      setState("error");
      setMessage("เบราว์เซอร์นี้ไม่รองรับการขอตำแหน่ง");
      return;
    }

    setState("loading");
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const form = formRef.current;
        if (!form) return;

        const set = (field: string, value: string) => {
          const input = form.elements.namedItem(field);
          if (input instanceof HTMLInputElement) {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
        };
        set("latitude", position.coords.latitude.toFixed(6));
        set("longitude", position.coords.longitude.toFixed(6));

        setState("idle");
        // บอกความแม่นไปเลย เพราะมันคือสิ่งที่ตัดสินว่าหมุดนี้เชื่อถือได้แค่ไหน
        // ยืนในอาคารแล้วได้ ±500 ม. = อย่าเอาพิกัดนี้ไปตั้งรัศมี 100 ม.
        setMessage(`ใส่พิกัดแล้ว (ความแม่น ±${Math.round(position.coords.accuracy)} ม.)`);
      },
      (error) => {
        setState("error");
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? "เบราว์เซอร์ปฏิเสธการขอตำแหน่ง — กดอนุญาตที่ไอคอนหน้าช่อง URL แล้วลองใหม่"
            : "หาตำแหน่งไม่ได้ ลองใหม่อีกครั้งหรือกรอกพิกัดเอง",
        );
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  return { fill, loading: state === "loading", error: state === "error", message };
}

function UseMyPositionButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <Button type="button" variant="ghost" onClick={onClick} disabled={loading}>
      <Crosshair className="mr-1.5 h-4 w-4" />
      {loading ? "กำลังหาตำแหน่ง…" : "ใช้ตำแหน่งปัจจุบัน"}
    </Button>
  );
}

export function SiteCreateForm({ companyId }: { companyId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { fill, loading, error, message } = useFillPosition(formRef);

  return (
    <form
      ref={formRef}
      action={createSiteAction}
      className="grid grid-cols-1 gap-3 sm:grid-cols-5"
    >
      <input type="hidden" name="company_id" value={companyId} />

      <Field label="ชื่อสถานที่ *">
        <input
          name="name"
          required
          maxLength={120}
          placeholder="สำนักงานใหญ่"
          className={inputClass}
        />
      </Field>

      <Field label="ละติจูด">
        <input
          name="latitude"
          inputMode="decimal"
          placeholder="13.756300"
          className={inputClass}
        />
      </Field>

      <Field label="ลองจิจูด">
        <input
          name="longitude"
          inputMode="decimal"
          placeholder="100.501800"
          className={inputClass}
        />
      </Field>

      <Field label="รัศมี (เมตร)" hint="เว้นว่าง = ใช้ค่าจากนโยบาย">
        <input
          name="radius_m"
          type="number"
          min={1}
          max={100000}
          placeholder="200"
          className={inputClass}
        />
      </Field>

      <div className="flex flex-col justify-end gap-2 sm:col-span-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <UseMyPositionButton onClick={fill} loading={loading} />
          {message && (
            <span
              className={`ml-2 text-xs ${error ? "text-(--danger)" : "text-(--ink-soft)"}`}
            >
              {message}
            </span>
          )}
        </div>
        <Button type="submit">เพิ่มสถานที่</Button>
      </div>
    </form>
  );
}

/**
 * การ์ดแก้ไขหนึ่งไซต์ — `<form>` ครอบทุกฟิลด์ของตัวเอง
 *
 * เลือกเป็นการ์ดแทนแถวในตารางโดยตั้งใจ: ถ้าใช้ตาราง ฟอร์มจะครอบหลาย `<td>`
 * ไม่ได้ ต้องไปผูก input ด้วย `form="id"` ข้ามเซลล์ ซึ่งเป็นการพึ่งกลไกที่
 * มองไม่เห็นตอนอ่านโค้ด · โปรเจกต์นี้เคยเจอฟอร์มพังเงียบ ๆ มาแล้วจากการฝากค่า
 * ไว้กับปุ่ม submit (`formAction` + `name`/`value` ไม่ส่งค่าไปกับ FormData)
 * ⇒ เลี่ยงทางที่ต้องใช้ลูกเล่นกับฟอร์มไว้ก่อน และใช้บนแท็บเล็ตได้สะดวกกว่าด้วย
 */
export function SiteEditCard({ site }: { site: Site }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { fill, loading, error, message } = useFillPosition(formRef);
  const hasPin = site.latitude !== null && site.longitude !== null;

  return (
    <form
      ref={formRef}
      action={updateSiteAction}
      className="rounded-(--radius) border border-(--line) p-3"
    >
      <input type="hidden" name="site_id" value={site.id} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <Field label="ชื่อสถานที่">
          <input
            name="name"
            defaultValue={site.name}
            maxLength={120}
            className={inputClass}
          />
        </Field>

        <Field label="ละติจูด">
          <input
            name="latitude"
            defaultValue={site.latitude ?? ""}
            inputMode="decimal"
            placeholder="ว่าง = ไม่มีหมุด"
            className={inputClass}
          />
        </Field>

        <Field label="ลองจิจูด">
          <input
            name="longitude"
            defaultValue={site.longitude ?? ""}
            inputMode="decimal"
            placeholder="ว่าง = ไม่มีหมุด"
            className={inputClass}
          />
        </Field>

        <Field label="รัศมี (เมตร)" hint="ว่าง = ใช้ค่าจากนโยบาย">
          <input
            name="radius_m"
            type="number"
            min={1}
            max={100000}
            defaultValue={site.radius_m ?? ""}
            placeholder="ตามนโยบาย"
            className={inputClass}
          />
          {/* GPS ทั่วไปคลาดเคลื่อนได้หลักสิบเมตรแม้กลางที่โล่ง — รัศมีแคบกว่านี้
              มักทำให้พนักงานยืนอยู่หน้างานจริงแต่ลงเวลาไม่ผ่าน (สเปคข้อ 4.9) */}
          {site.radius_m !== null && site.radius_m < 100 && (
            <span className="text-xs text-(--tone-warn)">
              ⚠ รัศมีแคบกว่าความแม่นยำ GPS ทั่วไป — พนักงานอาจลงเวลาไม่ผ่านทั้งที่อยู่หน้างาน
            </span>
          )}
        </Field>

        <Field label="สถานะ">
          <select name="status" defaultValue={site.status} className={inputClass}>
            <option value="ACTIVE">ใช้งาน</option>
            <option value="INACTIVE">ปิดใช้งาน</option>
          </select>
        </Field>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="mr-2 font-mono text-[11px] text-(--ink-soft)">{site.code}</span>
          <UseMyPositionButton onClick={fill} loading={loading} />
          {message && (
            <span
              className={`ml-2 text-xs ${error ? "text-(--danger)" : "text-(--ink-soft)"}`}
            >
              {message}
            </span>
          )}
          {!hasPin && message === null && (
            <span className="ml-2 text-xs text-(--tone-warn)">
              ยังไม่มีหมุด — ลงเวลาด้วยมือถือที่ไซต์นี้ยังไม่ได้
            </span>
          )}
        </div>
        <Button type="submit" variant="ghost">
          บันทึก
        </Button>
      </div>
    </form>
  );
}
