"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { createRequestAction, previewRequestAction, updateRequestAction, type Preview, type UploadedFile } from "../actions";
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
import { PersonPicker, type PickItem } from "./person-picker";
import { KindChip, MoneyRow, Notice } from "./ui";

export interface FormPerson {
  userId: string;
  name: string;
  email: string | null;
  roleLabel: string | null;
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

/** ค่าเดิมของใบที่กำลังแก้ (หน้า /requests/[id]/edit) */
export interface EditInitial {
  beneficiaryUserId: string;
  onBehalf: boolean;
  workDate: string;
  otStart: string;
  otEnd: string;
  rateId: string;
  amount: string;
  title: string;
  detail: string;
  lines: { item: string; amount: string }[];
  propertyId: string;
  workOrderId: string;
  vendorId: string;
  vendorName: string;
  vatOn: boolean;
  whtPercent: number;
  files: UploadedFile[];
}

export function RequestForm({
  editId,
  initial,
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
  /** มี = แก้ใบเดิม (เปลี่ยนประเภทไม่ได้) */
  editId?: string;
  initial?: EditInitial;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<RequestKind | null>(initialKind && kinds.includes(initialKind) ? initialKind : kinds.length === 1 ? kinds[0]! : null);
  const [beneficiary, setBeneficiary] = useState<string>(initial?.beneficiaryUserId ?? "");
  const [onBehalf, setOnBehalf] = useState(initial?.onBehalf ?? false);
  const [workDate, setWorkDate] = useState(initial?.workDate ?? today);
  const [otStart, setOtStart] = useState(initial?.otStart || "17:00");
  const [otEnd, setOtEnd] = useState(initial?.otEnd || "19:00");
  const [rateId, setRateId] = useState(initial?.rateId || (settings.otRates[0]?.id ?? ""));
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [lines, setLines] = useState<{ item: string; amount: string }[]>(initial?.lines.length ? initial.lines : [{ item: "", amount: "" }]);
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? "");
  const [workOrderId, setWorkOrderId] = useState(initial?.workOrderId ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [vendorName, setVendorName] = useState(initial?.vendorName ?? "");
  const [vatOn, setVatOn] = useState(initial?.vatOn ?? false);
  const [whtPercent, setWhtPercent] = useState(initial?.whtPercent ?? 3);
  const [files, setFiles] = useState<UploadedFile[]>(initial?.files ?? []);
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
        exceptRequestId: editId,
      });
      if (n !== seq.current) return;
      setChecking(false);
      if (res.ok) setPreview(res.preview);
    }, 350);
    return () => clearTimeout(t);
  }, [kind, effectiveBeneficiary, workDate, otStart, otEnd, rateId, numericAmount, editId]);

  const vendorInit = useRef(Boolean(editId));
  useEffect(() => {
    if (vendorInit.current) {
      vendorInit.current = false;
      return;
    }
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
      const payload = {
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
      };
      const res = editId ? await updateRequestAction(editId, payload) : await createRequestAction(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/requests/${res.id}?${editId ? "edited" : "created"}=1`);
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

  // รายชื่อสำหรับช่องค้นหา — บรรทัดรองแยกคนชื่อซ้ำ (แผนก · บทบาท · อีเมล)
  const peopleItems = (exclude: string | null): PickItem[] =>
    people
      .filter((p) => p.userId !== exclude)
      .map((p) => ({
        id: p.userId,
        name: p.name,
        badge: p.isWorker ? "คนงาน" : undefined,
        sub: [p.departmentName, p.isWorker ? "คนงานรายวัน" : p.roleLabel, p.email].filter(Boolean).join(" · "),
        keywords: p.email ?? "",
      }));

  const placeFields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <PersonPicker
        label="บ้าน / สถานที่ (ถ้ามี)"
        placeholder="พิมพ์ชื่อบ้าน"
        emptyText="ไม่พบบ้านนี้"
        allowClear
        items={properties.map((p) => ({ id: p.id, name: p.name, sub: "" }))}
        value={propertyId}
        onChange={(v) => {
          setPropertyId(v);
          setWorkOrderId("");
        }}
      />
      <PersonPicker
        label="ใบงานที่เกี่ยวข้อง (ถ้ามี)"
        placeholder="พิมพ์เลขใบงานหรือชื่องาน"
        emptyText="ไม่พบใบงาน"
        allowClear
        items={wos.map((w) => ({ id: w.id, name: `${w.code} · ${w.title}`, sub: properties.find((p) => p.id === w.propertyId)?.name ?? "" }))}
        value={workOrderId}
        onChange={(v) => {
          setWorkOrderId(v);
          const wo = wos.find((w) => w.id === v);
          if (wo && !propertyId) setPropertyId(wo.propertyId);
        }}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {editId ? (
        <div className="flex items-center gap-2 rounded-(--radius-lg) border border-(--line) bg-(--bg) px-4 py-3">
          <KindChip kind={kind} />
          <span className="text-sm font-bold text-(--ink)">แก้ไข{KIND_META[kind].label}</span>
          <span className="ml-auto text-xs text-(--ink-soft)">แก้ได้จนกว่าจะมีคนอนุมัติ</span>
        </div>
      ) : (
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
      )}

      <div className="flex flex-wrap items-start gap-4">
        {/* ───────── ฟอร์ม ───────── */}
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:p-5">
          {/* ใคร */}
          {kind === "contractor" ? (
            <div className="flex flex-col gap-2">
              <PersonPicker
                label="จ้างใคร"
                placeholder="พิมพ์ชื่อช่าง/ร้าน"
                emptyText="ยังไม่มีในทะเบียน — พิมพ์ชื่อในช่องด้านล่าง"
                allowClear
                items={vendors.map((v) => ({ id: v.id, name: v.name, sub: [v.whtPercent ? `หัก ณ ที่จ่าย ${v.whtPercent}%` : "ไม่หัก ณ ที่จ่าย", v.vatRegistered ? "จด VAT" : ""].filter(Boolean).join(" · ") }))}
                value={vendorId}
                onChange={(v) => {
                  setVendorId(v);
                  if (v) setVendorName("");
                }}
              />
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
                <PersonPicker label="ยื่นแทนใคร" items={peopleItems(null)} value={beneficiary} onChange={setBeneficiary} />
              )}
            </div>
          ) : (
            <PersonPicker
              label={kind === "ot" ? "ใครทำ OT" : "เบิกให้ใคร"}
              items={peopleItems(me.userId)}
              value={beneficiary}
              onChange={setBeneficiary}
              hint={kind === "ot" ? "ลง OT ให้ตัวเองไม่ได้" : "ขอให้ตัวเองไม่ได้"}
            />
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
                  <span className="text-xs text-(--ink-soft)">เปลี่ยนอัตราได้ที่เมนู ตั้งค่า</span>
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
                <span className={labelText}>ขอเงิน (บาท)</span>
                <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </label>
              {placeFields}
              <label className={labelCls}>
                <span className={labelText}>รายละเอียด</span>
                <textarea rows={2} className={`${field} h-auto py-2`} value={detail} onChange={(e) => setDetail(e.target.value)} />
              </label>
              <Notice>ได้เงินแล้ว ซื้อเสร็จต้อง<strong>ส่งใบเสร็จ + คืนเงินทอนภายใน {settings.clearDueDays} วัน</strong> — ระบบเตือนเมื่อใกล้ครบกำหนด</Notice>
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
                {person && preview?.payHidden ? (
                  <div className="border-t border-(--line) pt-2 text-sm text-(--ink-soft)">
                    ค่า OT: ระบบคิดจากเงินเดือนให้เอง ({preview.rateLabel ?? `${preview.percent ?? ""}%`}) — ยอดเงินเห็นเฉพาะเจ้าตัว / CEO / ผู้ดูแลเงินเดือน
                  </div>
                ) : person ? (
                  <MoneyRow strong label="ค่า OT" value={Number.isFinite(otAmount ?? NaN) ? (otAmount as number) : 0} hint={person.isWorker ? "คิดตามค่าแรงในโมดูลคนงาน" : preview?.rateLabel ?? undefined} />
                ) : (
                  <div className="border-t border-(--line) pt-2 text-sm text-(--ink-soft)">เลือกคนที่ทำ OT ก่อน ระบบจะคิดค่า OT ให้</div>
                )}
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
            {(kind === "cash_advance" || kind === "advance") && <MoneyRow strong label={kind === "advance" ? "เบิกล่วงหน้า" : "ขอเงินไปซื้อของ"} value={Number.isFinite(parseMoney(amount)) ? parseMoney(amount) : 0} />}
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
            {editId ? `บันทึกการแก้ไข${total > 0 ? ` ${baht(total)}` : ""}` : kind === "ot" ? "ส่งให้ HR ตรวจ" : `ส่งขออนุมัติ${total > 0 ? ` ${baht(total)}` : ""}`}
          </button>
          <p className="text-center text-xs text-(--ink-soft)">
            {thaiDate(workDate)} · แก้ไขได้จนกว่าจะมีคนอนุมัติ
          </p>
        </aside>
      </div>
    </div>
  );
}
