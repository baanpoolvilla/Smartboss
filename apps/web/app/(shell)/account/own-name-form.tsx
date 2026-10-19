"use client";

import { useState, useTransition } from "react";
import { Button } from "@smartboss/ui/components/button";

import { Field, inputClass } from "@/modules/admin/components/ui";
import { previewDisplayName } from "@/modules/hr/lib/display-name-preview";
import { updateOwnNameAction } from "./actions";

const FORMAT_LABEL: Record<string, string> = {
  NICK_FIRST: "ชื่อเล่น-ชื่อจริง",
  FIRST_NICK: "ชื่อจริง(ชื่อเล่น)",
  FULL_NAME: "ชื่อจริง นามสกุล",
};

/**
 * แก้ชื่อตัวเองเป็นสามช่อง — ชื่อที่แสดงประกอบตามรูปแบบที่บริษัทเลือก (ระบบบุคคล → ตั้งค่า → รูปแบบชื่อที่แสดง)
 * โชว์ตัวอย่างก่อนบันทึก กันกรอกสลับช่อง (เคสจริง: "Thunchanok-Nam" แทน "Nam-Thunchanok")
 */
export function OwnNameForm({ firstName, lastName, preferredName, format, current }: { firstName: string; lastName: string; preferredName: string; format: string; current: string }) {
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [nick, setNick] = useState(preferredName);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = previewDisplayName(first, last, nick, format);
  const changed = first.trim() !== firstName || last.trim() !== lastName || nick.trim() !== preferredName;

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="ชื่อเล่น">
          <input id="own-nick" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={100} placeholder="เช่น ภีม" className={inputClass} />
        </Field>
        <Field label="ชื่อ *">
          <input id="own-first" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={100} required className={inputClass} />
        </Field>
        <Field label="นามสกุล *">
          <input id="own-last" value={last} onChange={(e) => setLast(e.target.value)} maxLength={100} required className={inputClass} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-(--bg-soft) px-3 py-2 text-sm">
        <span className="text-(--ink-soft)">ชื่อที่คนอื่นจะเห็น</span>
        <b className="text-(--ink)">{preview || "—"}</b>
        <span className="text-xs text-(--ink-soft)">รูปแบบของบริษัท: {FORMAT_LABEL[format] ?? format}</span>
        {current !== preview && !changed && <span className="text-xs text-(--tone-warn)">ตอนนี้แสดงเป็น &quot;{current}&quot; — กดบันทึกเพื่อให้ตรงรูปแบบ</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:w-32"
          disabled={pending || !first.trim() || !last.trim() || (!changed && current === preview)}
          onClick={() =>
            startTransition(async () => {
              const r = await updateOwnNameAction({ firstName: first, lastName: last, preferredName: nick });
              setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `บันทึกแล้ว · แสดงเป็น "${r.name}"` });
            })
          }
        >
          บันทึก
        </Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-(--tone-ok)" : "text-(--tone-danger)"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
