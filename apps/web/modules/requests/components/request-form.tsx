"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { createRequestAction, previewRequestAction, type Preview, type UploadedFile } from "../actions";
import {
  KIND_META,
  amountMismatch,
  baht,
  contractorBreakdown,
  hoursText,
  minutesBetween,
  parseMoney,
  round2,
  thaiDate,
  type RequestKind,
  type RequestSettings,
} from "../lib/types";
import { FilePicker } from "./file-picker";
import { KindChip, MoneyRow, Notice } from "./ui";

export interface FormPerson {
  userId: string;
  name: string;
  isWorker: boolean;
  departmentName: string | null;
}
export interface FormVendor {
  id: string;
  name: string;
  whtPercent: number;
  vatRegistered: boolean;
}

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25";
const fieldNoW = field.replace("w-full ", "");
const labelCls = "flex flex-col gap-1.5 text-sm";
const labelText = "font-semibold text-(--ink)";

export function RequestForm({
  kinds,
  initialKind,
  me,
  canFileOthers,
  people,
  properties,
  workOrders,
  vendors,
  settings,
  today,
}: {
  kinds: RequestKind[];
  initialKind: RequestKind | null;
  me: { userId: string; name: string };
  canFileOthers: boolean;
  people: FormPerson[];
  properties: { id: string; name: string }[];
  workOrders: { id: string; code: string; title: string; propertyId: string }[];
  vendors: FormVendor[];
  settings: RequestSettings;
  today: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<RequestKind | null>(initialKind && kinds.includes(initialKind) ? initialKind : kinds.length === 1 ? kinds[0]! : null);
  const [beneficiary, setBeneficiary] = useState<string>("");
  const [onBehalf, setOnBehalf] = useState(false);
  const [workDate, setWorkDate] = useState(today);
  const [otStart, setOtStart] = useState("17:00");
  const [otEnd, setOtEnd] = useState("19:00");
  const [rateId, setRateId] = useState(settings.otRates[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [lines, setLines] = useState<{ item: string; amount: string }[]>([{ item: "", amount: "" }]);
  const [propertyId, setPropertyId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vatOn, setVatOn] = useState(false);
  const [whtPercent, setWhtPercent] = useState(3);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const selfKind = kind === "expense" || kind === "cash_advance";
  const effectiveBeneficiary = kind === "contractor" ? null : selfKind && !onBehalf ? me.userId : beneficiary || null;
  const person = people.find((p) => p.userId === effectiveBeneficiary) ?? null;
  const vendor = vendors.find((v) => v.id === vendorId) ?? null;

  // เปลี่ยนประเภท = ล้างค่าที่ไม่เกี่ยว (กันส่งตัวเลขของประเภทเดิมไป)
  function pickKind(k: RequestKind) {
    setKind(k);
    setError(null);
    setFiles([]);
    setAmount("");
    setTitle("");
    setLines([{ item: "", amount: "" }]);
    setPreview(null);
    setOnBehalf(false);
    setBeneficiary("");
    setWorkDate(today);
  }

  const linesTotal = useMemo(() => round2(lines.reduce((s, l) => s + (Number.isFinite(parseMoney(l.amount)) ? parseMoney(l.amount) : 0), 0)), [lines]);
  const usesLines = kind === "expense";
  const numericAmount = usesLines ? linesTotal : parseMoney(amount);

  // ตัวเลข/ข้อเตือนจากเซิร์ฟเวอร์ (เงินเดือน ค่าแรง เพดาน ผู้อนุมัติ ลงซ้ำ) — หน่วงสั้น ๆ ไม่ยิงทุกตัวอักษร
  const seq = useRef(0);
  useEffect(() => {
    if (!kind) return;
    if (kind !== "contractor" && !effectiveBeneficiary) {
      setPreview(null);
      return;
    }
    const n = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      const res = await previewRequestAction({
        kind,
        beneficiaryUserId: effectiveBeneficiary,
        workDate,
        otStart,
        otEnd,
        otRateId: rateId,
        amount: Number.isFinite(numericAmount) ? numericAmount : 0,
      });
      if (n !== seq.current) return;
      setChecking(false);
      if (res.ok) setPreview(res.preview);
    }, 350);
    return () => clearTimeout(t);
  }, [kind, effectiveBeneficiary, workDate, otStart, otEnd, rateId, numericAmount]);

  useEffect(() => {
    if (vendor) {
      setVatOn(vendor.vatRegistered);
      setWhtPercent(vendor.whtPercent);
    }
  }, [vendor]);

  const wos = workOrders.filter((w) => !propertyId || w.propertyId === propertyId);
  const receipts = files.filter((f) => f.role === "receipt");
  const mismatch = usesLines && receipts.length > 0 ? amountMismatch(receipts, linesTotal) : null;
  const breakdown = kind === "contractor" && Number.isFinite(parseMoney(amount)) ? contractorBreakdown(parseMoney(amount), vatOn ? settings.vatPercent : 0, whtPercent) : null;
  const otMinutes = /^\d{2}:\d{2}$/.test(otStart) && /^\d{2}:\d{2}$/.test(otEnd) ? minutesBetween(otStart, otEnd) : 0;
  const manualOt = kind === "ot" && preview?.baseKind === "manual";
  const otAmount = kind === "ot" ? (manualOt ? parseMoney(amount) : (preview?.amount ?? null)) : null;
  const blocks = preview?.blocks ?? [];
  const fileBlock = files.some((f) => f.duplicateOf);

  const total =
    kind === "contractor" ? (breakdown?.net ?? 0) : kind === "ot" ? (Number.isFinite(otAmount ?? NaN) ? (otAmount as number) : 0) : Number.isFinite(numericAmount) ? numericAmount : 0;

  function submit() {
    if (!kind) return;
    setError(null);
    startSave(async () => {
      const res = await createRequestAction({
        kind,
        beneficiaryUserId: effectiveBeneficiary,
        vendorId: vendorId || null,
        vendorName,
        title,
        detail,
        workDate,
        otStart,
        otEnd,
        otRateId: rateId,
        amount: kind === "contractor" || kind === "advance" || kind === "cash_advance" || manualOt ? parseMoney(amount) : usesLines ? linesTotal : undefined,
        lines: usesLines ? lines.map((l) => ({ item: l.item, amount: parseMoney(l.amount) })) : undefined,
        propertyId: propertyId || null,
        workOrderId: workOrderId || null,
        vatOn,
        whtPercent,
        attachments: files,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/requests/${res.id}?created=1`);
    });
  }

  /* ───────── เลือกประเภท ───────── */
  const picker = (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {kinds.map((k) => {
        const m = KIND_META[k];
        const on = kind === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => pickKind(k)}
            aria-pressed={on}
            className={`flex flex-col items-start gap-1 rounded-(--radius-lg) border p-3.5 text-left transition-colors ${on ? "border-2 border-(--brand-navy) bg-slate-50 p-[13px]" : "border-(--line) bg-(--bg) hover:bg-(--bg-soft)"}`}
          >
            <span className="flex items-center gap-2">
              <KindChip kind={k} />
              <span className="text-sm font-bold text-(--ink)">{m.label}</span>
            </span>
            <span className="text-xs text-(--ink-soft)">{m.hint}</span>
            <span className="text-[11px] text-(--ink-soft)">
              {m.who} · {m.approver}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (!kind) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-(--ink)">จะยื่นเรื่องอะไร</h2>
        {picker}
      </div>
    );
  }

  const peopleOptions = (exclude: string | null) => (
    <>
      <option value="">— เลือกคน —</option>
      <optgroup label="พนักงาน">
        {people.filter((p) => !p.isWorker && p.userId !== exclude).map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.name}
            {p.departmentName ? ` · ${p.departmentName}` : ""}
          </option>
        ))}
      </optgroup>
      <optgroup label="คนงานรายวัน">
        {people.filter((p) => p.isWorker && p.userId !== exclude).map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </>
  );

  const placeFields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className={labelCls}>
        <span className={labelText}>บ้าน / สถานที่ <span className="font-normal text-(--ink-soft)">(ถ้ามี)</span></span>
        <select className={field} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setWorkOrderId(""); }}>
          <option value="">— ไม่ระบุ —</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        <span className={labelText}>ใบงานที่เกี่ยวข้อง <span className="font-normal text-(--ink-soft)">(ถ้ามี)</span></span>
        <select className={field} value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
          <option value="">— ไม่ผูกใบงาน —</option>
          {wos.map((w) => (
            <option key={w.id} value={w.id}>{w.code} · {w.title}</option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <details className="group rounded-(--radius-lg) border border-(--line) bg-(--bg)">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
          <span className="flex items-center gap-2">
            <KindChip kind={kind} />
            <span className="text-sm font-bold text-(--ink)">{KIND_META[kind].label}</span>
          </span>
          <span className="text-xs font-medium text-(--app-strong)">เปลี่ยนประเภท</span>
        </summary>
        <div className="border-t border-(--line) p-3">{picker}</div>
      </details>

      <div className="flex flex-wrap items-start gap-4">
        {/* ───────── ฟอร์ม ───────── */}
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:p-5">
          {/* ใคร */}
          {kind === "contractor" ? (
            <div className="flex flex-col gap-2">
              <label className={labelCls}>
                <span className={labelText}>จ้างใคร</span>
                <select className={field} value={vendorId} onChange={(e) => { setVendorId(e.target.value); if (e.target.value) setVendorName(""); }}>
                  <option value="">— พิมพ์ชื่อใหม่ด้านล่าง —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              {!vendorId && (
                <input className={field} placeholder="ชื่อช่าง/ร้าน (ยังไม่อยู่ในทะเบียน)" value={vendorName} onChange={(e) => setVendorName(e.target.value)} aria-label="ชื่อช่างหรือร้าน" />
              )}
              <Link href="/requests/vendors" className="self-start text-xs font-medium text-(--app-strong) underline-offset-2 hover:underline">
                + เพิ่มเข้าทะเบียน (เก็บเลขภาษี บัญชีธนาคาร ไว้ใช้ครั้งต่อไป)
              </Link>
            </div>
          ) : selfKind ? (
            <div className="flex flex-col gap-2">
              {!onBehalf ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm">
                  <span>
                    เบิกให้: <strong>{me.name}</strong> (ตัวเอง)
                  </span>
                  {canFileOthers && (
                    <button type="button" className="text-xs font-medium text-(--app-strong) hover:underline" onClick={() => setOnBehalf(true)}>
                      ยื่นแทนคนอื่น
                    </button>
                  )}
                </div>
              ) : (
                <label className={labelCls}>
                  <span className={labelText}>ยื่นแทนใคร</span>
                  <select className={field} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}>
                    {peopleOptions(null)}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <label className={labelCls}>
              <span className={labelText}>{kind === "ot" ? "ทำ OT ให้ใคร" : "ขอเบิกให้ใคร"}</span>
              <select className={field} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}>
                {peopleOptions(me.userId)}
              </select>
              <span className="text-xs text-(--ink-soft)">{kind === "ot" ? "ลง OT ให้ตัวเองไม่ได้" : "ขอให้ตัวเองไม่ได้ — CEO เป็นคนอนุมัติ"}</span>
            </label>
          )}
          {person?.isWorker && (kind === "ot" || kind === "advance") && (
            <Notice tone="warn">
              <strong>คนงานรายวัน</strong> — {kind === "ot" ? "อนุมัติแล้วชั่วโมง OT เข้าบัญชีค่าแรงของคนงานเอง ไม่ต้องลงซ้ำที่หน้าคนงาน" : "จ่ายแล้วลงเป็น \"เบิกล่วงหน้า\" ในบัญชีค่าแรง หักคืนจากค่าแรงวันถัดไปเอง"}
            </Notice>
          )}

          {/* OT */}
          {kind === "ot" && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={labelCls}>
                  <span className={labelText}>วันที่ทำ</span>
                  <input type="date" className={field} value={workDate} max={today} onChange={(e) => setWorkDate(e.target.value)} />
                </label>
                <label className={labelCls}>
                  <span className={labelText}>เริ่ม</span>
                  <input type="time" className={field} value={otStart} onChange={(e) => setOtStart(e.target.value)} />
                </label>
                <label className={labelCls}>
                  <span className={labelText}>ถึง</span>
                  <input type="time" className={field} value={otEnd} onChange={(e) => setOtEnd(e.target.value)} />
                </label>
              </div>
              {otMinutes > 0 && <div className="-mt-2 text-xs text-(--ink-soft)">รวม {hoursText(otMinutes)}{otEnd <= otStart ? " (ข้ามเที่ยงคืน)" : ""}</div>}
              {person && !person.isWorker && (
                <label className={labelCls}>
                  <span className={labelText}>อัตรา OT</span>
                  <select className={field} value={rateId} onChange={(e) => setRateId(e.target.value)}>
                    {settings.otRates.map((r) => (
                      <option key={r.id} value={r.id}>{r.label} · {r.percent}%</option>
                    ))}
                  </select>
                  <span className="text-xs text-(--ink-soft)">แก้อัตราได้ที่ ตั้งค่า</span>
                </label>
              )}
              {manualOt && (
                <label className={labelCls}>
                  <span className={labelText}>ค่า OT (บาท)</span>
                  <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                  <span className="text-xs text-amber-700">{preview?.needsManual}</span>
                </label>
              )}
              <label className={labelCls}>
                <span className={labelText}>ทำอะไร</span>
                <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ซ่อมปั๊มสระด่วนหลังเลิกงาน" maxLength={160} />
              </label>
              <label className={labelCls}>
                <span className={labelText}>รายละเอียด <span className="font-normal text-(--ink-soft)">(ทำไมต้องทำนอกเวลา ใครสั่ง)</span></span>
                <textarea rows={3} className={`${field} h-auto py-2`} value={detail} onChange={(e) => setDetail(e.target.value)} />
              </label>
              {placeFields}
              <FilePicker role="evidence" files={files} onChange={setFiles} label="หลักฐาน (ถ้ามี)" hint="ไม่บังคับ — HR ตรวจจากเวลาสแกนเข้า-ออกได้ ถ้ามีรูปงาน/แชทสั่งงานแนบไว้จะตรวจง่ายขึ้น" today={today} />
            </>
          )}

          {/* เบิกค่าใช้จ่าย */}
          {kind === "expense" && (
            <>
              <FilePicker
                role="receipt"
                files={files}
                onChange={setFiles}
                label="ใบเสร็จ (อย่างน้อย 1 ใบ)"
                hint="ถ่ายให้เห็นยอดและวันที่ชัด ๆ — ระบบอ่านยอดให้"
                claimDate={workDate}
                today={today}
                maxAgeDays={settings.receiptMaxAgeDays}
                onAiRead={(f) => {
                  if (f.ai?.date && f.ai.date <= today) setWorkDate(f.ai.date);
                  // แต่ละใบเสร็จ = หนึ่งรายการ (เติมช่องว่างก่อน ไม่มีค่อยเพิ่มแถว) — แก้เองได้ทุกช่อง
                  const line = { item: f.ai?.vendor ?? "", amount: f.ai?.amount ? String(f.ai.amount) : "" };
                  setLines((ls) => {
                    const empty = ls.findIndex((l) => !l.item && !l.amount);
                    return empty >= 0 ? ls.map((l, i) => (i === empty ? line : l)) : [...ls, line];
                  });
                  setTitle((t) => t || f.ai?.vendor || "");
                }}
              />
              <label className={labelCls}>
                <span className={labelText}>เบิกค่าอะไร</span>
                <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ค่าทางด่วน ไป–กลับ ร้านอะไหล่" maxLength={160} />
              </label>
              <label className={labelCls}>
                <span className={labelText}>วันที่จ่าย (ตามใบเสร็จ)</span>
                <input type="date" className={field} value={workDate} max={today} onChange={(e) => setWorkDate(e.target.value)} />
              </label>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-(--ink)">รายการ</span>
                {lines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <input className={`${fieldNoW} min-w-0 flex-1`} placeholder="รายการ" value={l.item} aria-label={`รายการที่ ${i + 1}`} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
                    <input className={`${fieldNoW} w-28 shrink-0 text-right`} inputMode="decimal" placeholder="บาท" value={l.amount} aria-label={`จำนวนเงินรายการที่ ${i + 1}`} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                    {lines.length > 1 && (
                      <button type="button" aria-label="ลบรายการ" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-(--radius) border border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="inline-flex items-center gap-1 self-start text-sm font-medium text-(--app-strong) hover:underline" onClick={() => setLines([...lines, { item: "", amount: "" }])}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> เพิ่มรายการ
                </button>
              </div>
              {placeFields}
              <label className={labelCls}>
                <span className={labelText}>หมายเหตุ <span className="font-normal text-(--ink-soft)">(ถ้ามี)</span></span>
                <textarea rows={2} className={`${field} h-auto py-2`} value={detail} onChange={(e) => setDetail(e.target.value)} />
              </label>
            </>
          )}

          {/* เบิกเงินไปก่อน */}
          {kind === "cash_advance" && (
            <>
              <label className={labelCls}>
                <span className={labelText}>เอาไปซื้ออะไร</span>
                <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ซื้ออะไหล่ปั๊มสระ BS-M1" maxLength={160} />
              </label>
              <label className={labelCls}>
                <span className={labelText}>ขอเงินไปก่อน (บาท)</span>
                <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </label>
              {placeFields}
              <label className={labelCls}>
                <span className={labelText}>รายละเอียด</span>
                <textarea rows={2} className={`${field} h-auto py-2`} value={detail} onChange={(e) => setDetail(e.target.value)} />
              </label>
              <Notice>ได้เงินแล้วต้องเคลียร์ภายใน <strong>{settings.clearDueDays} วัน</strong> — ส่งใบเสร็จของที่ซื้อ + คืนเงินทอน ระบบเตือนเมื่อถึงกำหนด</Notice>
              <FilePicker role="evidence" files={files} onChange={setFiles} label="ไฟล์ประกอบ (ถ้ามี)" hint="ใบเสนอราคา รูปของที่จะซื้อ" today={today} />
            </>
          )}

          {/* เบิกล่วงหน้า */}
          {kind === "advance" && (
            <>
              <label className={labelCls}>
                <span className={labelText}>จำนวนเงิน (บาท)</span>
                <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </label>
              <label className={labelCls}>
                <span className={labelText}>เหตุผล</span>
                <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ค่ารักษาลูก" maxLength={160} />
              </label>
              <label className={labelCls}>
                <span className={labelText}>รายละเอียดเพิ่ม <span className="font-normal text-(--ink-soft)">(เห็นเฉพาะผู้อนุมัติ/HR)</span></span>
                <textarea rows={2} className={`${field} h-auto py-2`} value={detail} onChange={(e) => setDetail(e.target.value)} />
              </label>
              <FilePicker role="evidence" files={files} onChange={setFiles} label="ไฟล์ประกอบ (ถ้ามี)" today={today} />
            </>
          )}

          {/* ช่าง/ร้านภายนอก */}
          {kind === "contractor" && (
            <>
              <label className={labelCls}>
                <span className={labelText}>จ้างทำอะไร</span>
                <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ล้างแอร์ + เติมน้ำยา 3 เครื่อง" maxLength={160} />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  <span className={labelText}>วันที่ทำงาน</span>
                  <input type="date" className={field} value={workDate} max={today} onChange={(e) => setWorkDate(e.target.value)} />
                </label>
                <label className={labelCls}>
                  <span className={labelText}>ค่าจ้าง (ก่อน VAT)</span>
                  <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex h-11 items-center gap-2 rounded-(--radius) border border-(--line) px-3 text-sm">
                  <input type="checkbox" checked={vatOn} onChange={(e) => setVatOn(e.target.checked)} className="h-4 w-4" />
                  ร้านนี้จด VAT (บวก VAT {settings.vatPercent}%)
                </label>
                <label className={labelCls}>
                  <span className="sr-only">หัก ณ ที่จ่าย</span>
                  <select className={field} value={whtPercent} onChange={(e) => setWhtPercent(Number(e.target.value))} aria-label="หัก ณ ที่จ่าย">
                    {[...new Set([...settings.whtRates, whtPercent])].sort((a, b) => a - b).map((w) => (
                      <option key={w} value={w}>{w === 0 ? "ไม่หัก ณ ที่จ่าย" : `หัก ณ ที่จ่าย ${w}%`}</option>
                    ))}
                  </select>
                </label>
              </div>
              {placeFields}
              <label className={labelCls}>
                <span className={labelText}>รายละเอียด</span>
                <textarea rows={2} className={`${field} h-auto py-2`} value={detail} onChange={(e) => setDetail(e.target.value)} />
              </label>
              <FilePicker role="evidence" files={files} onChange={setFiles} label="หลักฐาน (อย่างน้อย 1)" hint="ใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ รูปงาน" today={today} />
            </>
          )}
        </div>

        {/* ───────── สรุป ───────── */}
        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 lg:sticky lg:top-4">
          <div className="flex flex-col gap-2.5 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-(--ink)">สรุปยอด</span>
              {checking && <Loader2 className="h-4 w-4 animate-spin text-(--ink-soft)" aria-label="กำลังคำนวณ" />}
            </div>
            {kind === "ot" && (
              <>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-(--ink-soft)">เวลา</span>
                  <span className="text-(--ink)">{otMinutes ? `${otStart}–${otEnd} · ${hoursText(otMinutes)}` : "—"}</span>
                </div>
                {preview?.formula && <div className="rounded-(--radius) bg-(--bg-soft) px-2.5 py-2 text-xs text-(--ink-soft)">{preview.formula}</div>}
                <MoneyRow strong label="ค่า OT" value={Number.isFinite(otAmount ?? NaN) ? (otAmount as number) : 0} hint={person?.isWorker ? "คิดตามค่าแรงในโมดูลคนงาน" : preview?.rateLabel ?? undefined} />
              </>
            )}
            {kind === "expense" && (
              <>
                {lines.filter((l) => l.item || l.amount).map((l, i) => (
                  <MoneyRow key={i} label={l.item || `รายการ ${i + 1}`} value={Number.isFinite(parseMoney(l.amount)) ? parseMoney(l.amount) : 0} />
                ))}
                <MoneyRow strong label="ขอเบิกรวม" value={linesTotal} />
                {mismatch && <Notice tone="warn">{mismatch}</Notice>}
              </>
            )}
            {(kind === "cash_advance" || kind === "advance") && <MoneyRow strong label={kind === "advance" ? "เบิกล่วงหน้า" : "ขอเงินไปก่อน"} value={Number.isFinite(parseMoney(amount)) ? parseMoney(amount) : 0} />}
            {kind === "advance" && preview && (
              <div className="rounded-(--radius) bg-(--bg-soft) px-2.5 py-2 text-xs text-(--ink-soft)">
                {preview.cap === null ? "ไม่จำกัดเพดาน" : `เพดานเดือนนี้ ${baht(preview.cap)} · ใช้ไปแล้ว ${baht(preview.capUsed)} · เหลือ ${baht(Math.max(0, preview.cap - preview.capUsed))}`}
              </div>
            )}
            {kind === "contractor" && breakdown && (
              <>
                <MoneyRow label="ค่าจ้าง (ก่อน VAT)" value={breakdown.base} />
                {breakdown.vat > 0 && <MoneyRow label={`VAT ${breakdown.vatPercent}%`} value={breakdown.vat} />}
                <MoneyRow label="ยอดตามบิลร้าน" value={breakdown.gross} />
                {breakdown.wht > 0 && <MoneyRow label={`หัก ณ ที่จ่าย ${breakdown.whtPercent}%`} hint="คิดจากยอดก่อน VAT · บริษัทนำส่งสรรพากรแทนร้าน" value={breakdown.wht} minus />}
                <MoneyRow strong label="จ่ายให้ร้านจริง" value={breakdown.net} />
              </>
            )}
          </div>

          {preview?.approverLevel && (
            <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 text-sm">
              <div className="font-bold text-(--ink)">ใครอนุมัติ</div>
              <div className="mt-1 text-(--ink-soft)">
                {preview.approverLevel === "ceo" ? "CEO" : "HR"}
                {preview.approverNames.length > 0 ? ` · ${preview.approverNames.join(", ")}` : ""}
              </div>
              {preview.needCeo && (
                <div className="mt-1 text-(--ink-soft)">
                  → แล้วต่อ CEO{preview.ceoNames.length > 0 ? ` · ${preview.ceoNames.join(", ")}` : ""}
                  <span className="block text-xs">ยอดเกินเกณฑ์ที่บริษัทตั้งไว้</span>
                </div>
              )}
              {kind === "ot" && <div className="mt-1 text-xs text-(--ink-soft)">HR ตรวจว่าทำจริง (ดูเวลาสแกน + หลักฐาน)</div>}
            </div>
          )}

          {blocks.map((b, i) => (
            <Notice key={`b${i}`} tone="danger">{b}</Notice>
          ))}
          {(preview?.warns ?? []).map((w, i) => (
            <Notice key={`w${i}`} tone="warn">{w}</Notice>
          ))}
          {error && <Notice tone="danger">{error}</Notice>}

          <button
            type="button"
            onClick={submit}
            disabled={saving || blocks.length > 0 || fileBlock || total <= 0 && kind !== "ot"}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-base font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {kind === "ot" ? "ส่งให้ HR ตรวจ" : `ส่งขออนุมัติ${total > 0 ? ` ${baht(total)}` : ""}`}
          </button>
          <p className="text-center text-xs text-(--ink-soft)">
            {thaiDate(workDate)} · ส่งแล้วแก้ไม่ได้ ยกเลิกแล้วยื่นใหม่ได้ระหว่างรออนุมัติ
          </p>
        </aside>
      </div>
    </div>
  );
}
