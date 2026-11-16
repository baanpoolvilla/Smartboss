"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, ClipboardCopy, Loader2, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Card } from "@smartboss/ui/components/card";

/**
 * ⚠ ตัวอย่างทดลอง (prototype) — ดู page.tsx · ข้อมูลทั้งหมดอยู่ใน localStorage ของเบราว์เซอร์นี้
 * สามหน้า: ส่งรายงานตามฟอร์ม (บังคับครบ) · รายงาน + AI วิเคราะห์/ถามตอบ · ตั้งค่าฟอร์ม/ห้อง/รอบ
 */

type Status = "g" | "y" | "r" | "";
type FieldType = "status" | "text" | "number" | "photo";
interface Field { id: string; label: string; hint: string; type: FieldType; required: boolean; allowNone: boolean }
interface FormDef { id: string; name: string; fields: Field[] }
interface Round { id: string; label: string; time: string; days: string; formIds: string[] }
interface Room { id: string; name: string; strict: boolean; rounds: Round[] }
interface Answer { fieldId: string; label: string; type: FieldType; status: Status; text: string; photos: number }
interface ChatMsg { role: "user" | "assistant"; content: string }
interface Usage { input: number; output: number }
interface Report { id: string; roomName: string; roundLabel: string; by: string; at: string; answers: Answer[]; analysis?: string; chat: ChatMsg[] }
interface Lab { forms: FormDef[]; rooms: Room[]; reports: Report[]; spent: { calls: number; input: number; output: number } }

const STATUS_LABEL: Record<Exclude<Status, "">, string> = { g: "เรียบร้อย", y: "ก้ำกึ่ง", r: "มีปัญหา" };
const STATUS_COLOR: Record<Exclude<Status, "">, string> = { g: "var(--tone-ok)", y: "#d39b00", r: "var(--tone-danger)" };
const TYPE_LABEL: Record<FieldType, string> = { status: "สีสถานะ + ข้อความ", text: "ข้อความ", number: "ตัวเลข", photo: "รูปงานจริง" };
const DAYS = ["ทุกวัน", "จันทร์–ศุกร์", "ทุกวันศุกร์", "สิ้นเดือน"];
const STORE_KEY = "sb-form-lab-v2";

/** ราคา gpt-4o-mini ต่อ 1 ล้าน token (ดอลลาร์) — ตัวเดียวกับที่ AI Insight ของระบบใช้ · อัตราแลกเปลี่ยนเป็นค่าสมมติ */
const USD_IN = 0.15;
const USD_OUT = 0.6;
const THB_PER_USD = 36;
const costThb = (u: Usage) => ((u.input * USD_IN + u.output * USD_OUT) / 1_000_000) * THB_PER_USD;
const fmtThb = (n: number) => (n < 0.01 ? n.toFixed(4) : n.toFixed(2));

const uid = () => Math.random().toString(36).slice(2, 9);
const f = (id: string, label: string, hint: string, type: FieldType = "status", required = true, allowNone = true): Field => ({ id, label, hint, type, required, allowNone });

function seed(): Lab {
  const forms: FormDef[] = [
    {
      id: "common",
      name: "Common Report",
      fields: [
        f("c1", "วันนี้ส่งงานอะไร", "ระบุงานที่เสร็จวันนี้ จำนวน เปอร์เซ็นต์ หรือหลักฐานที่ตรวจสอบได้", "status", true, false),
        f("c2", "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน", "ถ้าผิดแผน แผนใหม่คืออะไร"),
        f("c3", "ปัญหาและความเสี่ยง", "เกิดอะไรแล้ว อะไรกำลังจะเกิด ใครได้รับผลกระทบ ถ้าไม่แก้จะเป็นอย่างไร"),
        f("c4", "วิธีแก้ไขและความรับผิดชอบ", "แก้อะไรไปแล้ว ผลเป็นอย่างไร ใครเป็นเจ้าของปัญหา ปิดได้เมื่อไหร่"),
        f("c5", "เรื่องที่ต้องการให้ Boss ตัดสินใจ", "เสนอ Option A/B พร้อมผลกระทบและทางที่แนะนำ"),
      ],
    },
    {
      id: "tech",
      name: "Department: ช่าง",
      fields: [
        f("d1", "ใบแจ้งซ่อมที่ปิดวันนี้ (ใบ)", "", "number", true, false),
        f("d2", "รูปงานจริง", "รูปถ่ายหน้างานเท่านั้น ไม่ใช้รูปที่เจนจาก AI", "photo", true, false),
        f("d3", "รายละเอียดเพิ่มเติมของแผนก", "เขียนตามลักษณะงาน", "text", false, false),
      ],
    },
    { id: "plan", name: "แผนงานเช้า", fields: [f("p1", "วันนี้จะทำอะไร", "เรียงตามลำดับความสำคัญ", "text", true, false), f("p2", "ต้องการความช่วยเหลือจากใคร", "", "text", false, false)] },
    { id: "weekly", name: "Weekly Summary", fields: [f("w1", "ผลงานเทียบเป้าของสัปดาห์", "", "status", true, false), f("w2", "แผนสัปดาห์หน้า", "", "text", true, false)] },
  ];
  const rooms: Room[] = [
    {
      id: "tech",
      name: "Daily Report · ช่าง",
      strict: true,
      rounds: [
        { id: "r1", label: "แผนงานเช้า", time: "09:00", days: "จันทร์–ศุกร์", formIds: ["plan"] },
        { id: "r2", label: "Daily Report เย็น", time: "18:00", days: "ทุกวัน", formIds: ["common", "tech"] },
        { id: "r3", label: "Weekly", time: "17:00", days: "ทุกวันศุกร์", formIds: ["weekly"] },
      ],
    },
    { id: "sales", name: "Daily Report · เซลล์/แอดมิน", strict: true, rounds: [{ id: "r4", label: "Daily Report เย็น", time: "18:00", days: "ทุกวัน", formIds: ["common"] }] },
    { id: "acc", name: "Daily Report · บัญชี", strict: false, rounds: [{ id: "r5", label: "Daily Report เย็น", time: "18:00", days: "ทุกวัน", formIds: [] }] },
  ];
  const a = (fieldId: string, label: string, status: Status, text: string): Answer => ({ fieldId, label, type: "status", status, text, photos: 0 });
  const reports: Report[] = [
    {
      id: "s1", roomName: "Daily Report · ช่าง", roundLabel: "Daily Report เย็น", by: "ต้น (ช่าง)", at: "17:42", chat: [],
      answers: [
        a("c1", "วันนี้ส่งงานอะไร", "g", "ปิดใบแจ้งซ่อม 4 ใบ บ้าน A3 และ B1 ล้างแอร์ครบ 6 ตัว"),
        a("c2", "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน", "y", "ปั๊มน้ำบ้าน C2 รออะไหล่ เลื่อนเป็นพรุ่งนี้บ่าย"),
        a("c3", "ปัญหาและความเสี่ยง", "r", "หลังคาบ้าน A1 รั่ว มีแขกเข้าเสาร์นี้ ถ้าไม่ซ่อมห้องนอนใหญ่ใช้ไม่ได้"),
        a("c4", "วิธีแก้ไขและความรับผิดชอบ", "y", "นัดช่างหลังคาพรุ่งนี้ 9:00 ผมเป็นเจ้าของเรื่อง ปิดได้วันศุกร์"),
        a("c5", "เรื่องที่ต้องการให้ Boss ตัดสินใจ", "y", "A ซ่อมเฉพาะจุด 3,500 บาท / B เปลี่ยนทั้งแผ่น 12,000 บาท แนะนำ A"),
      ],
    },
    {
      id: "s2", roomName: "Daily Report · ช่าง", roundLabel: "Daily Report เย็น", by: "กาย (ช่าง)", at: "17:55", chat: [],
      answers: [a("c1", "วันนี้ส่งงานอะไร", "g", "PM สระน้ำ 3 หลัง ครบตามแผน"), a("c2", "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน", "g", "ไม่มี"), a("c3", "ปัญหาและความเสี่ยง", "g", "ไม่มี"), a("c4", "วิธีแก้ไขและความรับผิดชอบ", "g", "ไม่มี"), a("c5", "เรื่องที่ต้องการให้ Boss ตัดสินใจ", "g", "ไม่มี")],
    },
  ];
  return { forms, rooms, reports, spent: { calls: 0, input: 0, output: 0 } };
}

const reportText = (r: Report) =>
  `รายงานของ ${r.by} · ${r.roomName} · ${r.roundLabel} · ${r.at} น.\n` +
  r.answers
    .map((x) => `${x.type === "status" && x.status ? `[${STATUS_LABEL[x.status]}] ` : ""}${x.label}: ${x.type === "photo" ? `${x.photos} รูป` : x.text || "-"}`)
    .join("\n");

const norm = (s: string) => s.replace(/[\s.…:*—–\-]/g, "");
const EMO: Record<string, Status> = { "🔴": "r", "🟡": "y", "🟢": "g" };

function Dot({ s, size = 12 }: { s: Status; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: s ? STATUS_COLOR[s] : "transparent", border: s ? "none" : "2px dashed var(--ink-soft)" }}
    />
  );
}

const input = "w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) outline-none focus:border-(--brand-navy)";
const pill = (on: boolean) =>
  `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${on ? "border-(--brand-navy) bg-(--brand-navy) font-semibold text-white" : "border-(--line) bg-(--bg) text-(--ink-soft)"}`;

export function FormLab({ userName, boss }: { userName: string; boss: string }) {
  const [lab, setLab] = useState<Lab>(seed);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<"send" | "reports" | "settings">("send");
  const [roomId, setRoomId] = useState("tech");
  const [roundId, setRoundId] = useState("r2");
  const [answers, setAnswers] = useState<Record<string, { status: Status; text: string; photos: number }>>({});
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<Record<string, Usage>>({});
  const [question, setQuestion] = useState<Record<string, string>>({});
  const [formId, setFormId] = useState("common");
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดค่าที่ลองเล่นค้างไว้ครั้งเดียวหลัง mount (localStorage อ่านตอน render ฝั่งเซิร์ฟเวอร์ไม่ได้)
      if (raw) setLab(JSON.parse(raw) as Lab);
    } catch {
      // อ่านไม่ได้ใช้ค่าตัวอย่าง
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(lab));
    } catch {
      // เต็ม/โหมดส่วนตัว — ไม่เป็นไร
    }
  }, [lab, ready]);

  const room = lab.rooms.find((r) => r.id === roomId) ?? lab.rooms[0]!;
  const round = room.rounds.find((r) => r.id === roundId) ?? room.rounds[0];
  const fields = useMemo(
    () => (round?.formIds ?? []).flatMap((id) => { const fm = lab.forms.find((x) => x.id === id); return fm ? fm.fields.map((field) => ({ form: fm, field })) : []; }),
    [round, lab.forms],
  );
  const ans = (id: string) => answers[id] ?? { status: "" as Status, text: "", photos: 0 };
  const setAns = (id: string, patch: Partial<{ status: Status; text: string; photos: number }>) => setAnswers((p) => ({ ...p, [id]: { ...(p[id] ?? { status: "", text: "", photos: 0 }), ...patch } }));
  const done = (x: Field) => { const a = ans(x.id); return x.type === "status" ? !!a.status && !!a.text.trim() : x.type === "photo" ? a.photos > 0 : !!a.text.trim(); };
  const required = fields.filter((x) => x.field.required);
  const doneCount = required.filter((x) => done(x.field)).length;
  const statusFields = fields.filter((x) => x.field.type === "status").map((x) => x.field);

  async function callAi(body: object, key: string): Promise<{ content: string; usage: Usage } | null> {
    setBusy(key);
    try {
      const res = await fetch("/api/report-task/form-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { content?: string; usage?: Usage; error?: string };
      if (!res.ok || !data.usage) { setNote(data.error ?? "เรียก AI ไม่สำเร็จ"); return null; }
      const usage = data.usage;
      setLastUsage((p) => ({ ...p, [key]: usage }));
      setLab((p) => ({ ...p, spent: { calls: p.spent.calls + 1, input: p.spent.input + usage.input, output: p.spent.output + usage.output } }));
      return { content: data.content ?? "", usage };
    } catch {
      setNote("เชื่อมต่อ AI ไม่ได้");
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** แยกแบบไม่ใช้ AI: จับชื่อหัวข้อ + อีโมจิสีหน้าหัวข้อ (ไม่มีค่าใช้จ่าย) */
  function splitByHeadings() {
    const lines = paste.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[.…_\-=\s]+$/.test(l));
    const next: typeof answers = { ...answers };
    let cur: string | null = null;
    let found = 0;
    const free = fields.find((x) => x.field.type === "text")?.field;
    let dept = false;
    const deptLines: string[] = [];
    for (const line of lines) {
      if (/department\s*module/i.test(line)) { dept = true; cur = null; continue; }
      if (/common\s*report/i.test(line)) continue;
      const n = norm(line.replace(/[🔴🟡🟢🏁]/gu, ""));
      const hit = statusFields.find((t) => n.startsWith(norm(t.label)));
      if (hit) {
        found += 1; cur = hit.id; dept = false;
        let st: Status = "";
        for (const e of Object.keys(EMO)) if (line.includes(e)) st = EMO[e]!;
        next[hit.id] = { status: st, text: "", photos: 0 };
        continue;
      }
      if (dept) deptLines.push(line);
      else if (cur) next[cur] = { ...next[cur]!, text: next[cur]!.text ? `${next[cur]!.text}\n${line}` : line };
    }
    for (const t of statusFields) { const a = next[t.id]; if (a && !a.status && a.text.trim() === "ไม่มี") a.status = "g"; }
    if (free && deptLines.length) next[free.id] = { status: "", text: deptLines.join("\n"), photos: 0 };
    if (!found) { setNote("ไม่พบชื่อหัวข้อตามฟอร์มในข้อความที่วาง — ลองกด “ให้ AI แยกให้” หรือคัดลอกฟอร์มเปล่าไปเขียนตาม"); return; }
    setAnswers(next);
    setNote(`แยกลงช่องให้แล้ว ${found} จาก ${statusFields.length} หัวข้อ (ไม่ใช้ AI ไม่มีค่าใช้จ่าย) ตรวจด้านล่างแล้วกดส่ง`);
  }

  async function splitByAi() {
    if (!paste.trim()) { setNote("ยังไม่ได้วางข้อความ"); return; }
    const r = await callAi({ mode: "split", topics: statusFields.map((t) => ({ id: t.id, label: t.label, hint: t.hint })), text: paste }, "split");
    if (!r) return;
    try {
      const parsed = JSON.parse(r.content) as { answers?: { id: string; status: string; text: string }[] };
      const map: Record<string, Status> = { green: "g", yellow: "y", red: "r", none: "" };
      const next: typeof answers = { ...answers };
      let filled = 0;
      for (const x of parsed.answers ?? []) {
        if (!statusFields.some((t) => t.id === x.id)) continue;
        const st = map[x.status] ?? "";
        next[x.id] = { status: st, text: st ? String(x.text ?? "") : "", photos: 0 };
        if (st && x.text) filled += 1;
      }
      setAnswers(next);
      setNote(`AI แยกให้แล้ว ${filled} จาก ${statusFields.length} หัวข้อ · ใช้ ${r.usage.input + r.usage.output} token ≈ ${fmtThb(costThb(r.usage))} บาท · ตรวจสีและข้อความก่อนส่ง`);
    } catch {
      setNote("AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้ ลองกดอีกครั้ง");
    }
  }

  function copyTemplate() {
    const tpl = "🏁Common Report🏁\n" + statusFields.map((t) => `🟢${t.label}\n(เปลี่ยนสีตามจริง แล้วเขียนรายละเอียดบรรทัดนี้)`).join("\n") + "\n🏁Department Module🏁\n(เขียนตามงานของแผนก)";
    navigator.clipboard.writeText(tpl).then(() => setNote("คัดลอกฟอร์มเปล่าแล้ว เอาไปวางให้ AI ที่ใช้อยู่เขียนตามหัวข้อนี้"), () => { setPaste(tpl); setNote("คัดลอกอัตโนมัติไม่ได้ ใส่ฟอร์มเปล่าไว้ในช่องให้แล้ว"); });
  }

  function submit() {
    if (!round) return;
    if (doneCount < required.length) { setShowMissing(true); setNote(null); return; }
    const report: Report = {
      id: uid(), roomName: room.name, roundLabel: round.label, by: `${userName} (ทดลองส่ง)`,
      at: new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date()),
      chat: [],
      answers: fields.map(({ field }) => ({ fieldId: field.id, label: field.label, type: field.type, ...ans(field.id) })),
    };
    setLab((p) => ({ ...p, reports: [report, ...p.reports] }));
    setAnswers({}); setPaste(""); setShowMissing(false); setNote(null); setJustSent(true); setTab("reports");
  }

  async function analyze(r: Report) {
    const res = await callAi({ mode: "analyze", report: reportText(r) }, `a-${r.id}`);
    if (res) setLab((p) => ({ ...p, reports: p.reports.map((x) => (x.id === r.id ? { ...x, analysis: res.content } : x)) }));
  }
  async function ask(r: Report) {
    const q = (question[r.id] ?? "").trim();
    if (!q) return;
    const history: ChatMsg[] = [...(r.analysis ? [{ role: "assistant" as const, content: r.analysis }] : []), ...r.chat];
    setQuestion((p) => ({ ...p, [r.id]: "" }));
    setLab((p) => ({ ...p, reports: p.reports.map((x) => (x.id === r.id ? { ...x, chat: [...x.chat, { role: "user", content: q }] } : x)) }));
    const res = await callAi({ mode: "chat", report: reportText(r), history, question: q }, `c-${r.id}`);
    if (res) setLab((p) => ({ ...p, reports: p.reports.map((x) => (x.id === r.id ? { ...x, chat: [...x.chat, { role: "assistant", content: res.content }] } : x)) }));
  }
  function copyForOwnAi(r: Report) {
    const text = `ช่วยวิเคราะห์รายงานประจำวันนี้ให้หน่อย: 1) สรุปสั้น 2) จุดที่ต้องจับตา 3) ควรทำอย่างไรต่อ 4) คำถามที่ควรถามกลับ\n\n${reportText(r)}`;
    navigator.clipboard.writeText(text).then(() => setNote("คัดลอกรายงานพร้อมคำสั่งแล้ว เอาไปวางใน AI ที่ใช้อยู่ได้เลย (ไม่มีค่าใช้จ่ายในระบบ)"), () => setNote("คัดลอกอัตโนมัติไม่ได้"));
  }

  const updateForm = (id: string, fn: (fm: FormDef) => FormDef) => setLab((p) => ({ ...p, forms: p.forms.map((x) => (x.id === id ? fn(x) : x)) }));
  const updateRoom = (id: string, fn: (r: Room) => Room) => setLab((p) => ({ ...p, rooms: p.rooms.map((x) => (x.id === id ? fn(x) : x)) }));
  const updateRound = (rid: string, roundKey: string, fn: (r: Round) => Round) => updateRoom(rid, (r) => ({ ...r, rounds: r.rounds.map((x) => (x.id === roundKey ? fn(x) : x)) }));

  const spentThb = costThb(lab.spent);
  const reds = lab.reports.flatMap((r) => r.answers.filter((x) => x.status === "r").map((x) => ({ r, x })));
  const yellows = lab.reports.flatMap((r) => r.answers.filter((x) => x.status === "y").map((x) => ({ r, x })));
  const decides = lab.reports.flatMap((r) => r.answers.filter((x) => x.label.includes("ตัดสินใจ") && x.text.trim() && x.text.trim() !== "ไม่มี").map((x) => ({ r, x })));
  const editing = lab.forms.find((x) => x.id === formId) ?? lab.forms[0]!;

  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="rounded-(--radius) border border-(--tone-warn) p-3 text-sm text-(--ink)">
        <strong>หน้าตัวอย่างทดลอง</strong> ใช้ดูแนวทางก่อนสร้างจริง ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ไม่ได้บันทึกเข้าระบบ
        ปุ่มที่มีคำว่า AI เรียก AI จริงและมีค่าใช้จ่ายจริงเล็กน้อย
      </div>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="หน้าในตัวอย่าง">
        <button type="button" className={pill(tab === "send")} onClick={() => setTab("send")}>ส่งรายงาน</button>
        <button type="button" className={pill(tab === "reports")} onClick={() => setTab("reports")}>รายงาน + AI ({lab.reports.length})</button>
        <button type="button" className={pill(tab === "settings")} onClick={() => setTab("settings")}>ตั้งค่าฟอร์ม / ห้อง / รอบ</button>
      </nav>

      {note && (
        <p role="status" className="rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">{note}</p>
      )}

      {/* ───────────── ส่งรายงาน ───────────── */}
      {tab === "send" && (
        <div className="flex flex-col gap-3">
          <Card className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-(--ink-soft)">ห้อง</span>
              <select className={input} value={room.id} onChange={(e) => { const r = lab.rooms.find((x) => x.id === e.target.value)!; setRoomId(r.id); setRoundId(r.rounds[0]?.id ?? ""); setAnswers({}); setShowMissing(false); }}>
                {lab.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-(--ink-soft)">รอบที่ส่ง</span>
              <select className={input} value={round?.id ?? ""} onChange={(e) => { setRoundId(e.target.value); setAnswers({}); setShowMissing(false); }}>
                {room.rounds.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.days} · ภายใน {r.time} น.</option>)}
              </select>
            </label>
            <p className="text-xs text-(--ink-soft) sm:col-span-2">
              รอบนี้ต้องส่ง:{" "}
              {round && round.formIds.length > 0
                ? round.formIds.map((id) => lab.forms.find((x) => x.id === id)?.name).filter(Boolean).join(" + ")
                : "ไม่ได้กำหนดฟอร์ม (พิมพ์อิสระได้ตามเดิม)"}
              {room.strict && round && round.formIds.length > 0 ? " · ห้องนี้บังคับส่งตามฟอร์ม" : ""}
            </p>
          </Card>

          {fields.length === 0 ? (
            <Card className="p-4 text-sm text-(--ink-soft)">รอบนี้ยังไม่ได้กำหนดฟอร์ม ส่งรายงานแบบพิมพ์อิสระได้ตามเดิม — กำหนดได้ที่แท็บ “ตั้งค่าฟอร์ม / ห้อง / รอบ”</Card>
          ) : (
            <>
              {statusFields.length > 0 && (
                <Card className="grid gap-2 border-(--brand-navy) p-4">
                  <label htmlFor="lab-paste" className="text-sm font-semibold text-(--ink)">เขียนไว้ที่อื่นแล้ว? วางทั้งก้อนได้เลย</label>
                  <textarea id="lab-paste" className={`${input} min-h-24`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="วางรายงานที่นี่ แล้วเลือกวิธีแยกลงช่อง" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={splitByHeadings} disabled={!paste.trim()}>แยกตามหัวข้อ (ฟรี)</Button>
                    <Button type="button" size="sm" variant="outline" onClick={splitByAi} disabled={busy === "split" || !paste.trim()}>
                      {busy === "split" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} ให้ AI แยกให้
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={copyTemplate}><ClipboardCopy className="h-4 w-4" /> คัดลอกฟอร์มเปล่า</Button>
                  </div>
                  <p className="text-xs text-(--ink-soft)">
                    “แยกตามหัวข้อ” ใช้ได้เมื่อข้อความมีชื่อหัวข้อตรงกับฟอร์ม ไม่เสียค่าใช้จ่าย · “ให้ AI แยกให้” ใช้กับข้อความที่พิมพ์ธรรมดาไม่มีหัวข้อ มีค่าใช้จ่ายต่อครั้ง
                  </p>
                </Card>
              )}

              {fields.map(({ form, field }, i) => {
                const a = ans(field.id);
                const miss = showMissing && field.required && !done(field);
                const first = i === 0 || fields[i - 1]!.form.id !== form.id;
                return (
                  <div key={field.id} className="grid gap-2">
                    {first && <p className="mt-1 text-xs font-semibold tracking-wide text-(--ink-soft)">{form.name}</p>}
                    <Card className={`grid gap-2 p-4 ${miss ? "border-(--tone-danger)" : ""}`}>
                      <label htmlFor={`lab-${field.id}`} className="text-sm font-semibold text-(--ink)">
                        {field.label} {field.required ? <span className="text-(--tone-danger)">*</span> : <span className="font-normal text-(--ink-soft)">(ไม่บังคับ)</span>}
                      </label>
                      {field.hint && <p className="text-xs text-(--ink-soft)">{field.hint}</p>}
                      {field.type === "status" && (
                        <div className="flex flex-wrap gap-2" role="group" aria-label="สถานะ">
                          {(["g", "y", "r"] as const).map((s) => (
                            <button
                              key={s}
                              type="button"
                              aria-pressed={a.status === s}
                              onClick={() => setAns(field.id, { status: s })}
                              className="inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm"
                              style={a.status === s ? { borderColor: STATUS_COLOR[s], borderWidth: 2, fontWeight: 600, color: "var(--ink)" } : { borderColor: "var(--line)", color: "var(--ink-soft)" }}
                            >
                              <Dot s={s} /> {STATUS_LABEL[s]}
                            </button>
                          ))}
                          {field.allowNone && (
                            <button type="button" onClick={() => setAns(field.id, { status: "g", text: "ไม่มี" })} className="min-h-10 rounded-full border border-(--line) px-3 text-sm text-(--ink-soft)">
                              ไม่มี
                            </button>
                          )}
                        </div>
                      )}
                      {field.type === "photo" ? (
                        <div className="flex flex-wrap gap-2">
                          {Array.from({ length: a.photos }, (_, n) => (
                            <span key={n} className="grid h-18 w-18 place-items-center rounded-(--radius) border border-(--line) bg-(--bg-soft) text-xs text-(--ink)">รูป {n + 1}</span>
                          ))}
                          <button id={`lab-${field.id}`} type="button" onClick={() => setAns(field.id, { photos: Math.min(6, a.photos + 1) })} className="grid h-18 w-18 place-items-center rounded-(--radius) border border-dashed border-(--ink-soft) text-xs text-(--ink-soft)">
                            + ถ่าย/เลือก
                          </button>
                        </div>
                      ) : field.type === "number" ? (
                        <input id={`lab-${field.id}`} type="number" inputMode="numeric" min={0} className={`${input} max-w-40`} value={a.text} onChange={(e) => setAns(field.id, { text: e.target.value })} />
                      ) : (
                        <textarea id={`lab-${field.id}`} className={`${input} min-h-20`} value={a.text} onChange={(e) => setAns(field.id, { text: e.target.value })} placeholder="พิมพ์รายละเอียด" />
                      )}
                      {miss && <p className="text-xs text-(--tone-danger)">{field.type === "status" ? "เลือกสีและพิมพ์รายละเอียด หรือกด “ไม่มี”" : "ยังไม่ได้กรอกข้อนี้"}</p>}
                    </Card>
                  </div>
                );
              })}

              {fields.some((x) => ans(x.field.id).status === "r") && (
                <p className="rounded-(--radius) border border-(--tone-danger) bg-(--danger-bg) px-3 py-2 text-sm text-(--ink)">
                  มีข้อที่เลือก <strong>มีปัญหา</strong> — ส่งแล้ว {boss} จะเห็นในรายการ “มีปัญหา” ทันที
                </p>
              )}

              <div className="sticky bottom-0 -mx-1 flex items-center gap-3 rounded-(--radius) border border-(--line) bg-(--bg) p-3 shadow-(--shadow-card)">
                <span className="whitespace-nowrap text-sm text-(--ink-soft)">กรอกแล้ว {doneCount}/{required.length}</span>
                <div className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-(--line)">
                  <div className="h-full bg-(--brand-navy)" style={{ width: `${required.length ? Math.round((doneCount / required.length) * 100) : 0}%` }} />
                </div>
                <Button type="button" onClick={submit} className="h-11">ส่งรายงาน</Button>
              </div>
              {showMissing && doneCount < required.length && (
                <p role="alert" className="text-sm text-(--tone-danger)">ยังขาด {required.length - doneCount} ข้อที่บังคับ (กรอบแดงด้านบน) — ส่งได้เมื่อครบตามฟอร์ม</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ───────────── รายงาน + AI ───────────── */}
      {tab === "reports" && (
        <div className="flex flex-col gap-3">
          {justSent && <p role="status" className="rounded-(--radius) border border-(--tone-ok) px-3 py-2 text-sm text-(--ink)">ส่งรายงานแล้ว ครบตามฟอร์ม</p>}
          <div className="grid gap-3 sm:grid-cols-4">
            <Card className="p-3"><p className="text-xs text-(--ink-soft)">รอ {boss} ตัดสินใจ</p><p className="text-2xl font-bold text-(--ink)">{decides.length}</p></Card>
            <Card className="p-3"><p className="text-xs text-(--ink-soft)">ข้อที่มีปัญหา</p><p className="text-2xl font-bold" style={{ color: "var(--tone-danger)" }}>{reds.length}</p></Card>
            <Card className="p-3"><p className="text-xs text-(--ink-soft)">ข้อที่ก้ำกึ่ง</p><p className="text-2xl font-bold" style={{ color: "#b88700" }}>{yellows.length}</p></Card>
            <Card className="p-3">
              <p className="text-xs text-(--ink-soft)">ค่า AI ที่ใช้ไปในหน้านี้</p>
              <p className="text-2xl font-bold text-(--ink)">{fmtThb(spentThb)} <span className="text-sm font-normal">บาท</span></p>
              <p className="text-xs text-(--ink-soft)">{lab.spent.calls} ครั้ง · {(lab.spent.input + lab.spent.output).toLocaleString()} token</p>
            </Card>
          </div>
          <p className="text-xs text-(--ink-soft)">ตัวเลข 3 ช่องแรกนับจากช่องในฟอร์มโดยตรง ไม่ใช้ AI ไม่มีค่าใช้จ่าย · ค่า AI คิดจากจำนวน token จริงที่ราคา gpt-4o-mini อัตรา {THB_PER_USD} บาท/ดอลลาร์ (สมมติ)</p>

          {lab.reports.map((r) => (
            <Card key={r.id} className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-(--ink)">{r.by}</span>
                <span className="text-xs text-(--ink-soft)">{r.roomName} · {r.roundLabel} · {r.at} น.</span>
                <span className="ml-auto flex gap-1.5">
                  {(["r", "y", "g"] as const).map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-full border border-(--line) px-2 text-xs tabular-nums text-(--ink)"><Dot s={s} size={10} />{r.answers.filter((x) => x.status === s).length}</span>
                  ))}
                </span>
              </div>
              <div className="grid gap-2">
                {r.answers.map((x) => (
                  <div key={x.fieldId} className="flex gap-2 text-sm">
                    <span className="mt-1.5 w-3.5 shrink-0">{x.type === "status" ? <Dot s={x.status} /> : null}</span>
                    <p className="min-w-0 whitespace-pre-wrap text-(--ink-soft)"><strong className="text-(--ink)">{x.label}</strong><br />{x.type === "photo" ? `${x.photos} รูป` : x.text || "—"}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-(--line) pt-3">
                <Button type="button" size="sm" onClick={() => analyze(r)} disabled={busy === `a-${r.id}`}>
                  {busy === `a-${r.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} {r.analysis ? "วิเคราะห์ใหม่" : "ให้ AI วิเคราะห์"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => copyForOwnAi(r)}><ClipboardCopy className="h-4 w-4" /> คัดลอกไปถาม AI ที่ใช้อยู่ (ฟรี)</Button>
              </div>

              {r.analysis && (
                <div className="grid gap-2 rounded-(--radius) bg-(--bg-soft) p-3">
                  <p className="flex items-center gap-2 text-xs font-semibold text-(--ink)"><Bot className="h-4 w-4" /> AI วิเคราะห์
                    {lastUsage[`a-${r.id}`] && <span className="font-normal text-(--ink-soft)">· {lastUsage[`a-${r.id}`]!.input + lastUsage[`a-${r.id}`]!.output} token ≈ {fmtThb(costThb(lastUsage[`a-${r.id}`]!))} บาท</span>}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-(--ink)">{r.analysis}</p>
                  {r.chat.map((m, i) => (
                    <p key={i} className={`whitespace-pre-wrap rounded-(--radius) px-3 py-2 text-sm ${m.role === "user" ? "ml-auto max-w-[85%] bg-(--brand-navy) text-white" : "mr-auto max-w-[95%] border border-(--line) bg-(--bg) text-(--ink)"}`}>{m.content}</p>
                  ))}
                  {busy === `c-${r.id}` && <p className="flex items-center gap-2 text-sm text-(--ink-soft)"><Loader2 className="h-4 w-4 animate-spin" /> AI กำลังตอบ…</p>}
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(r); }}>
                    <input className={input} value={question[r.id] ?? ""} onChange={(e) => setQuestion((p) => ({ ...p, [r.id]: e.target.value }))} placeholder="ถามต่อ เช่น งานแบบนี้ควรจัดการยังไง" aria-label="ถาม AI เกี่ยวกับรายงานนี้" />
                    <Button type="submit" size="sm" className="h-10 shrink-0" disabled={busy === `c-${r.id}` || !(question[r.id] ?? "").trim()}><Send className="h-4 w-4" /> ถาม</Button>
                  </form>
                  {lastUsage[`c-${r.id}`] && <p className="text-xs text-(--ink-soft)">คำถามล่าสุด: {lastUsage[`c-${r.id}`]!.input + lastUsage[`c-${r.id}`]!.output} token ≈ {fmtThb(costThb(lastUsage[`c-${r.id}`]!))} บาท</p>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ───────────── ตั้งค่า ───────────── */}
      {tab === "settings" && (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Card className="grid gap-3 p-4">
            <h2 className="text-sm font-semibold text-(--ink)">1. แบบฟอร์ม</h2>
            <div className="flex flex-wrap gap-2">
              {lab.forms.map((fm) => <button key={fm.id} type="button" className={pill(fm.id === editing.id)} onClick={() => setFormId(fm.id)}>{fm.name}</button>)}
              <button type="button" className="rounded-full border border-dashed border-(--ink-soft) px-3 py-1.5 text-sm text-(--ink-soft)" onClick={() => { const id = uid(); setLab((p) => ({ ...p, forms: [...p.forms, { id, name: "ฟอร์มใหม่", fields: [f(uid(), "หัวข้อใหม่", "")] }] })); setFormId(id); }}>
                <Plus className="inline h-4 w-4" /> ฟอร์มใหม่
              </button>
            </div>
            <input className={`${input} font-semibold`} value={editing.name} onChange={(e) => updateForm(editing.id, (fm) => ({ ...fm, name: e.target.value }))} aria-label="ชื่อฟอร์ม" />
            {editing.fields.map((field, i) => (
              <div key={field.id} className="grid gap-2 rounded-(--radius) border border-(--line) p-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input className={`${input} sm:flex-1`} value={field.label} aria-label="ชื่อหัวข้อ" onChange={(e) => updateForm(editing.id, (fm) => ({ ...fm, fields: fm.fields.map((x) => (x.id === field.id ? { ...x, label: e.target.value } : x)) }))} />
                  <select className={`${input} sm:w-48 sm:shrink-0`} value={field.type} aria-label="ชนิดช่อง" onChange={(e) => updateForm(editing.id, (fm) => ({ ...fm, fields: fm.fields.map((x) => (x.id === field.id ? { ...x, type: e.target.value as FieldType } : x)) }))}>
                    {(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <input className={input} value={field.hint} placeholder="คำอธิบายใต้หัวข้อ (ไม่ใส่ก็ได้)" aria-label="คำอธิบาย" onChange={(e) => updateForm(editing.id, (fm) => ({ ...fm, fields: fm.fields.map((x) => (x.id === field.id ? { ...x, hint: e.target.value } : x)) }))} />
                <div className="flex flex-wrap items-center gap-3 text-sm text-(--ink-soft)">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4.5 w-4.5 accent-(--brand-navy)" checked={field.required} onChange={(e) => updateForm(editing.id, (fm) => ({ ...fm, fields: fm.fields.map((x) => (x.id === field.id ? { ...x, required: e.target.checked } : x)) }))} /> บังคับตอบ</label>
                  {field.type === "status" && <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4.5 w-4.5 accent-(--brand-navy)" checked={field.allowNone} onChange={(e) => updateForm(editing.id, (fm) => ({ ...fm, fields: fm.fields.map((x) => (x.id === field.id ? { ...x, allowNone: e.target.checked } : x)) }))} /> มีปุ่ม “ไม่มี”</label>}
                  <span className="ml-auto flex gap-1">
                    <Button type="button" size="sm" variant="outline" disabled={i === 0} aria-label="เลื่อนขึ้น" onClick={() => updateForm(editing.id, (fm) => { const a = [...fm.fields]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; return { ...fm, fields: a }; })}>↑</Button>
                    <Button type="button" size="sm" variant="outline" disabled={i === editing.fields.length - 1} aria-label="เลื่อนลง" onClick={() => updateForm(editing.id, (fm) => { const a = [...fm.fields]; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; return { ...fm, fields: a }; })}>↓</Button>
                    <Button type="button" size="sm" variant="outline" aria-label="ลบหัวข้อ" onClick={() => updateForm(editing.id, (fm) => ({ ...fm, fields: fm.fields.filter((x) => x.id !== field.id) }))}><Trash2 className="h-4 w-4" /></Button>
                  </span>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => updateForm(editing.id, (fm) => ({ ...fm, fields: [...fm.fields, f(uid(), "หัวข้อใหม่", "")] }))}><Plus className="h-4 w-4" /> เพิ่มหัวข้อ</Button>
            <p className="text-xs text-(--ink-soft)">แก้แล้วมีผลกับรายงานครั้งถัดไป รายงานที่ส่งไปแล้วไม่เปลี่ยน</p>
          </Card>

          <div className="grid gap-3">
            <h2 className="text-sm font-semibold text-(--ink)">2. ห้องไหน รอบไหน เวลาไหน ส่งฟอร์มอะไร</h2>
            {lab.rooms.map((r) => (
              <Card key={r.id} className="grid gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-semibold text-(--ink)">{r.name}</h3>
                  <label className="inline-flex items-center gap-2 text-sm text-(--ink-soft)"><input type="checkbox" className="h-4.5 w-4.5 accent-(--brand-navy)" checked={r.strict} onChange={(e) => updateRoom(r.id, (x) => ({ ...x, strict: e.target.checked }))} /> บังคับส่งตามฟอร์ม</label>
                </div>
                {r.rounds.map((rd) => (
                  <div key={rd.id} className="grid gap-2 rounded-(--radius) border border-(--line) p-3">
                    <div className="flex flex-wrap gap-2">
                      <input className={`${input} min-w-40 flex-1`} value={rd.label} aria-label="ชื่อรอบ" onChange={(e) => updateRound(r.id, rd.id, (x) => ({ ...x, label: e.target.value }))} />
                      <input type="time" className={`${input} w-32 shrink-0`} value={rd.time} aria-label="ส่งภายในเวลา" onChange={(e) => updateRound(r.id, rd.id, (x) => ({ ...x, time: e.target.value }))} />
                      <select className={`${input} w-40 shrink-0`} value={rd.days} aria-label="วันที่ต้องส่ง" onChange={(e) => updateRound(r.id, rd.id, (x) => ({ ...x, days: e.target.value }))}>{DAYS.map((d) => <option key={d}>{d}</option>)}</select>
                      <Button type="button" size="sm" variant="outline" aria-label="ลบรอบ" className="h-10 shrink-0" onClick={() => updateRoom(r.id, (x) => ({ ...x, rounds: x.rounds.filter((y) => y.id !== rd.id) }))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-(--ink-soft)">ฟอร์มที่ต้องส่ง:</span>
                      {rd.formIds.length === 0 && <span className="text-(--ink-soft)">ไม่กำหนด (พิมพ์อิสระ)</span>}
                      {rd.formIds.map((id) => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-(--brand-navy) px-2.5 py-0.5 text-xs text-white">
                          {lab.forms.find((x) => x.id === id)?.name ?? "?"}
                          <button type="button" aria-label="เอาฟอร์มนี้ออก" onClick={() => updateRound(r.id, rd.id, (x) => ({ ...x, formIds: x.formIds.filter((y) => y !== id) }))}>×</button>
                        </span>
                      ))}
                      <select className="rounded-full border border-(--line) bg-(--bg) px-2 py-1 text-xs text-(--ink)" value="" aria-label="เพิ่มฟอร์ม" onChange={(e) => e.target.value && updateRound(r.id, rd.id, (x) => ({ ...x, formIds: [...x.formIds, e.target.value] }))}>
                        <option value="">+ เพิ่มฟอร์ม</option>
                        {lab.forms.filter((x) => !rd.formIds.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => updateRoom(r.id, (x) => ({ ...x, rounds: [...x.rounds, { id: uid(), label: "รอบใหม่", time: "18:00", days: "ทุกวัน", formIds: [] }] }))}><Plus className="h-4 w-4" /> เพิ่มรอบ</Button>
              </Card>
            ))}
            <Button type="button" variant="outline" onClick={() => { setLab(seed()); setAnswers({}); setNote("คืนค่าตัวอย่างแล้ว"); }}>คืนค่าตัวอย่างทั้งหมด</Button>
          </div>
        </div>
      )}
    </div>
  );
}
