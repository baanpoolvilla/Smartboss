"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import type { CheckinPolicyGroup, Site } from "@/modules/hr/lib/api";
import {
  assignCheckinPolicyAction,
  assignUnassignedToCheckinPolicyAction,
  createCheckinPolicyAction,
} from "../actions";

/**
 * ค่าตั้งต้นที่ฟอร์มเปิดมาให้ = ชุดที่ "ใช้งานได้จริงตั้งแต่วันแรก"
 *
 * ตั้งใจให้หลวมกว่าค่า default ของ workforce (ซึ่งบังคับถ่ายรูปทุกครั้ง +
 * บังคับเครื่องที่อนุมัติแล้ว) เพราะสองข้อนั้นบน LINE Mini App คือกำแพงที่
 * ทำให้พนักงานลงเวลาไม่ผ่านตั้งแต่วันแรกโดยไม่มีใครรู้สาเหตุ
 *
 * และเพราะบน webview ตรวจ device attestation / mock GPS ไม่ได้อยู่แล้ว
 * (docs/line-mini-app-checkin-spec.md ข้อ 0.4) การเปิด `require_enrolled_device`
 * จึงได้ความเข้มงวดน้อยกว่าที่คิด แต่แลกด้วยงานอนุมัติเครื่องของ HR ทุกคน
 *
 * ⚠ ค่าเหล่านี้เป็นแค่ค่า *ตั้งต้นของฟอร์ม* ไม่ใช่กฎที่ฝังในโค้ด — ทุกบริษัท
 * ปรับเองได้ทั้งหมดตามกฎ "ห้าม hard code กฎธุรกิจ"
 */
const checkboxClass = "h-5 w-5 rounded border-(--line) accent-(--app)";

export function CreatePolicyForm({
  companyId,
  sites,
}: {
  companyId: string;
  sites: Site[];
}) {
  const [photoRequired, setPhotoRequired] = useState("DISABLED");

  return (
    <form action={createCheckinPolicyAction} className="space-y-4">
      <input type="hidden" name="company_id" value={companyId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="ชื่อนโยบาย *">
          <input
            name="name"
            required
            maxLength={120}
            placeholder="พนักงานหน้างาน"
            className={inputClass}
          />
        </Field>

        <Field label="รัศมีที่ยอมรับ (เมตร)" hint="ใช้เมื่อสถานที่ไม่ได้ตั้งรัศมีเอง">
          <input
            name="radius_m"
            type="number"
            min={1}
            max={100000}
            defaultValue={200}
            className={inputClass}
          />
        </Field>

        <Field
          label="ความแม่นยำต่ำสุดที่รับได้ (เมตร)"
          hint="GPS ในอาคารมักแย่กว่า 50 ม."
        >
          <input
            name="max_accuracy_m"
            type="number"
            min={1}
            max={10000}
            defaultValue={100}
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">วิธีลงเวลาที่อนุญาต *</legend>
        <div className="flex flex-wrap gap-4">
          <Check name="allowed_methods" value="MOBILE_PHOTO" defaultChecked>
            มือถือ (Mini App)
          </Check>
          <Check name="allowed_methods" value="FINGERPRINT_DEVICE" defaultChecked>
            เครื่องสแกนนิ้ว
          </Check>
          <Check name="allowed_methods" value="WEB">
            เว็บ
          </Check>
          <Check name="allowed_methods" value="MANUAL">
            บันทึกย้อนหลังโดย HR
          </Check>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="การถ่ายรูป">
          <select
            name="photo_required"
            value={photoRequired}
            onChange={(e) => setPhotoRequired(e.target.value)}
            className={inputClass}
          >
            <option value="DISABLED">ไม่ต้องถ่ายรูป</option>
            <option value="ALWAYS">บังคับถ่ายทุกครั้ง</option>
            <option value="RISK_BASED">ถ่ายเมื่อพบความเสี่ยง</option>
          </select>
        </Field>

        <Field label="เมื่อพบความเสี่ยง">
          <select name="risk_action" defaultValue="REVIEW" className={inputClass}>
            <option value="REVIEW">บันทึกไว้ แล้วส่งให้ HR ตรวจ</option>
            <option value="WARN">บันทึกไว้ แค่เตือน</option>
            <option value="REJECT">ปฏิเสธไปเลย</option>
          </select>
        </Field>

        <Field label="เก็บรูปไว้กี่วัน" hint="ลบอัตโนมัติเมื่อครบ">
          <input
            name="photo_retention_days"
            type="number"
            min={1}
            max={3650}
            defaultValue={90}
            className={inputClass}
          />
        </Field>
      </div>

      {sites.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            จำกัดเฉพาะสถานที่{" "}
            <span className="font-normal text-(--ink-soft)">
              (ไม่ติ๊กเลย = ใช้ได้ทุกสถานที่)
            </span>
          </legend>
          <div className="flex flex-wrap gap-4">
            {sites.map((site) => (
              <Check key={site.id} name="allowed_site_ids" value={site.id}>
                {site.name}
              </Check>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
        <Check name="location_required" value="1" defaultChecked>
          บังคับส่งพิกัด
        </Check>
        <Check name="require_live_capture" value="1" defaultChecked>
          รูปต้องถ่ายสด ไม่ใช่เลือกจากคลัง
        </Check>
        <Check name="require_enrolled_device" value="1">
          เครื่องต้องได้รับอนุมัติก่อน
        </Check>
      </div>

      <p className="rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">
        “เครื่องต้องได้รับอนุมัติก่อน” ไม่ได้ติ๊กไว้ให้โดยตั้งใจ — เปิดแล้ว HR ต้องกด
        อนุมัติเครื่องของพนักงานทุกคนก่อนถึงจะลงเวลาได้ครั้งแรก และบนเว็บใน LINE
        ตัวระบุเครื่องเป็นค่าที่ล้าง/คัดลอกได้ จึงกันการยืมเครื่องกันได้น้อยกว่าที่คิด
      </p>

      <Button type="submit">สร้างนโยบาย</Button>
    </form>
  );
}

function Check({
  name,
  value,
  defaultChecked,
  children,
}: {
  name: string;
  value: string;
  defaultChecked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className={checkboxClass}
      />
      {children}
    </label>
  );
}

export function AssignPanel({
  groups,
  employees,
  unassignedCount,
}: {
  groups: CheckinPolicyGroup[];
  employees: { id: string; label: string; groupId: string | null }[];
  unassignedCount: number;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-(--ink-soft)">
        สร้างนโยบายอย่างน้อยหนึ่งกลุ่มก่อน แล้วถึงจะจัดพนักงานเข้ากลุ่มได้
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {unassignedCount > 0 && (
        <form
          action={assignUnassignedToCheckinPolicyAction}
          className="rounded-(--radius) border border-(--tone-warn)/40 bg-(--bg-soft) p-3"
        >
          <p className="mb-2 text-sm">
            มีพนักงาน <strong>{unassignedCount} คน</strong> ที่ยังไม่ได้อยู่กลุ่มไหนเลย —
            คนกลุ่มนี้จะตกไปใช้ค่ามาตรฐานที่เข้มมาก และมักลงเวลาไม่ผ่าน
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select name="policy_group_id" required className={`${inputClass} sm:max-w-xs`}>
              <option value="">— เลือกกลุ่มที่จะจัดให้ —</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <Button type="submit">จัดทุกคนที่ยังไม่มีกลุ่มเข้ากลุ่มนี้</Button>
          </div>
          <p className="mt-2 text-xs text-(--ink-soft)">
            ไม่แตะคนที่ถูกจัดกลุ่มไว้แล้ว
          </p>
        </form>
      )}

      <form action={assignCheckinPolicyAction} className="flex flex-col gap-2 sm:flex-row">
        <select name="employment_id" required className={inputClass}>
          <option value="">— เลือกพนักงาน —</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.label}
            </option>
          ))}
        </select>
        <select name="policy_group_id" required className={inputClass}>
          <option value="">— เลือกกลุ่ม —</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="ghost">
          ย้ายเข้ากลุ่ม
        </Button>
      </form>
    </div>
  );
}
