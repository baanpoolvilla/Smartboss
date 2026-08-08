"use client";

import { useState } from "react";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { MultiPicker, type PickOption } from "./multi-picker";

const inputClass =
  "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export interface PmAssetOption {
  id: string;
  name: string;
  propertyId: string;
  propertyName: string;
}

/**
 * ฟอร์มสร้าง PM — port จาก _showCreatePmDialog
 * เลือกอุปกรณ์ได้หลายชิ้น (สร้าง 1 แผน/อุปกรณ์) หรือผูกกับบ้านอย่างเดียว
 */
export function PmForm({
  action,
  properties,
  assets,
  users,
  frequencies,
  maxRounds,
  defaultPropertyId,
  defaultAssetId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  properties: PickOption[];
  assets: PmAssetOption[];
  users: PickOption[];
  frequencies: { value: string; label: string }[];
  /** ความถี่ → จำนวนรอบสูงสุดต่อปี (0 = กำหนดรอบไม่ได้) */
  maxRounds: Record<string, number>;
  defaultPropertyId?: string;
  defaultAssetId?: string;
}) {
  const [mode, setMode] = useState<
    "continuous" | "yearlyRounds" | "limitedCount"
  >("continuous");
  const [frequency, setFrequency] = useState("monthly");
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? "");
  const [assetIds, setAssetIds] = useState<string[]>(
    defaultAssetId ? [defaultAssetId] : []
  );

  const max = maxRounds[frequency] ?? 0;
  const assetOptions: PickOption[] = assets.map((a) => ({
    id: a.id,
    label: a.name,
    sub: a.propertyName,
  }));

  return (
    <Card className="p-5">
      <form action={action} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">ชื่องาน PM *</span>
          <input
            name="title"
            required
            maxLength={200}
            placeholder="เช่น ล้างแอร์ประจำปี"
            className={inputClass}
          />
        </label>

        {/* อุปกรณ์หลายชิ้น — เลือกแล้วบ้านยึดตามอุปกรณ์ */}
        <MultiPicker
          name="assetIds"
          title="เลือกอุปกรณ์"
          heading="อุปกรณ์ (เลือกได้หลายชิ้น)"
          hint="เลือกอุปกรณ์ที่ต้องทำ PM แบบเดียวกัน — ระบบจะสร้าง 1 แผนต่อ 1 อุปกรณ์"
          emptyText="ไม่เลือก (ผูกกับบ้านอย่างเดียว)"
          addLabel="เลือกอุปกรณ์"
          options={assetOptions}
          defaultSelected={assetIds}
          onChange={setAssetIds}
        />

        {assetIds.length === 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">บ้าน *</span>
            <select
              name="propertyId"
              required
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className={inputClass}
            >
              <option value="">— เลือกบ้าน —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {assetIds.length > 0 && (
          <input type="hidden" name="propertyId" value={assets[0]?.propertyId ?? ""} />
        )}

        {/* ─── ประเภท PM ─── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-(--ink)">ประเภท PM *</span>
          {(
            [
              ["continuous", "ทำต่อเนื่อง", "ทำซ้ำตามความถี่ไปเรื่อย ๆ"],
              ["yearlyRounds", "ทำเป็นรอบต่อปี", "ทำ N รอบ/ปีแล้วเว้นยาว"],
              ["limitedCount", "จำกัดจำนวนครั้ง", "ทำครบ N ครั้งแล้วจบ"],
            ] as const
          ).map(([v, label, hint]) => (
            <label
              key={v}
              className="flex items-start gap-2 rounded-(--radius) border p-2.5"
              style={{
                borderColor: mode === v ? "#0D9488" : "var(--line)",
                backgroundColor: mode === v ? "#F0FDFA" : "transparent",
              }}
            >
              <input
                type="radio"
                name="mode"
                value={v}
                checked={mode === v}
                onChange={() => setMode(v)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-medium text-(--ink)">
                  {label}
                </span>
                <span className="block text-xs text-(--ink-soft)">{hint}</span>
              </span>
            </label>
          ))}
        </div>

        {mode !== "limitedCount" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">ความถี่ *</span>
            <select
              name="frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className={inputClass}
            >
              {frequencies.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "yearlyRounds" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">
              จำนวนรอบต่อปี{max > 1 ? ` (สูงสุด ${max})` : ""}
            </span>
            {max > 1 ? (
              <select name="roundsPerYear" defaultValue="2" className={inputClass}>
                {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} รอบ/ปี
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-[#DC2626]">
                ความถี่นี้กำหนดรอบต่อปีไม่ได้ — ระบบจะบันทึกเป็นแบบทำต่อเนื่อง
              </span>
            )}
          </label>
        )}

        {mode === "limitedCount" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">
              จำนวนครั้งทั้งหมด *
            </span>
            <input
              name="totalRounds"
              type="number"
              min={2}
              max={24}
              defaultValue={6}
              className={inputClass}
            />
            <span className="text-xs text-(--ink-soft)">
              ทำครบแล้วปิดสัญญา — แต่ละครั้งนัดวันเองหลังจบงานก่อนหน้า
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">
            วันกำหนดรอบแรก *
          </span>
          <input name="nextDueDate" type="date" required className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">มอบหมายช่าง</span>
          <select name="assignedTo" defaultValue="" className={inputClass}>
            <option value="">— ยังไม่ระบุ —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.sub ? `${u.label} (${u.sub})` : u.label}
              </option>
            ))}
          </select>
        </label>

        <MultiPicker
          name="ccUserIds"
          title="เพิ่ม CC (แจ้งสำเนา)"
          heading="CC (แจ้งสำเนา)"
          hint="เลือกผู้รับสำเนาการแจ้งเตือน (LINE + in-app)"
          emptyText="ไม่มี (ไม่บังคับ)"
          addLabel="เพิ่ม CC"
          options={users}
          chipBg="#FFF7ED"
          icon="user"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">รายละเอียด</span>
          <textarea
            name="description"
            rows={2}
            className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
          />
        </label>

        <Button type="submit" className="w-full sm:w-40">
          สร้าง PM
        </Button>
      </form>
    </Card>
  );
}
