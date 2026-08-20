import { Check, Minus, ShieldCheck } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Plain-language reference for "who can see/do what" in this module —
 * mirrors the actual functions in lib/permissions.ts + lib/directory.ts
 * (canEditRecord, canSeeTask, canAccessCompanySection, isIssueAgent, ...)
 * so it can't silently drift from what the code actually enforces: every row
 * below names the exact rule it's describing in a trailing code comment,
 * making it easy to re-check against source next time permissions change.
 * Static/read-only — this is documentation, not a settings form.
 */

type Level = "full" | "scoped" | "own" | "none";

const LEVEL_META: Record<Level, { label: string; className: string }> = {
  full: { label: "ทั้งหมด", className: "bg-green-50 text-[var(--brand-green-dark)]" },
  scoped: { label: "เฉพาะแผนก/ที่เกี่ยวข้อง", className: "bg-amber-50 text-[var(--chart-amber)]" },
  own: { label: "เฉพาะของตัวเอง", className: "bg-blue-50 text-blue-700" },
  none: { label: "ไม่ได้", className: "bg-slate-100 text-[var(--ink-soft)]" },
};

function LevelCell({ level }: { level: Level }) {
  const meta = LEVEL_META[level];
  if (level === "none") {
    return (
      <div className="flex items-center justify-center py-2">
        <Minus className="h-3.5 w-3.5 text-[var(--ink-soft)]/50" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center py-2">
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap", meta.className)}>
        <Check className="h-2.5 w-2.5 shrink-0" />
        {meta.label}
      </span>
    </div>
  );
}

interface Row {
  action: string;
  note?: string;
  owner: Level;
  head: Level;
  employee: Level;
}

interface Group {
  title: string;
  rows: Row[];
}

const ROLE_COLUMNS = ["เจ้าของบริษัท", "หัวหน้าแผนก", "พนักงานทั่วไป"];

const GROUPS: Group[] = [
  {
    title: "งาน / บอร์ด Kanban",
    rows: [
      { action: "เห็นงาน", note: "canSeeTask", owner: "full", head: "scoped", employee: "own" },
      { action: "สร้าง/แก้ไข/ลบงาน (ชื่อ ผู้รับผิดชอบ วันครบกำหนด ฯลฯ)", note: "canEditRecord — หัวหน้าแผนกแก้ได้เฉพาะงานของแผนกที่ตนเป็นหัวหน้า, พนักงานแก้ได้เฉพาะงานที่ตัวเองสร้าง", owner: "full", head: "scoped", employee: "own" },
      { action: "กด \"ผ่าน / ไม่ผ่าน\" ตรวจงาน (เสร็จสิ้น ↔ รอตรวจสอบ)", note: "ใช้เงื่อนไขเดียวกับ canEditRecord", owner: "full", head: "scoped", employee: "none" },
      { action: "ติ๊กช่องเช็คลิสต์", note: "canToggleOwnChecklistItem — ติ๊กได้เฉพาะช่องที่ตัวเองเป็นเจ้าของ แม้เป็นหัวหน้า/เจ้าของบริษัทก็ติ๊กแทนคนอื่นไม่ได้", owner: "own", head: "own", employee: "own" },
      { action: "ลบสติกเกอร์ที่ให้ไปแล้ว", note: "canRemoveReaction — ลบได้เฉพาะที่ตัวเองให้ หรือของแผนกที่ตนดูแล", owner: "full", head: "scoped", employee: "none" },
      { action: "ยกเลิกโทษ \"เลยกำหนด\" อัตโนมัติ", note: "canOverrideAutoPenalty — เจ้าของบริษัทเท่านั้น", owner: "full", head: "none", employee: "none" },
    ],
  },
  {
    title: "ปฏิทิน",
    rows: [
      { action: "เห็นงานของคนอื่นในปฏิทิน", note: "canSeeTaskOnCalendar (ดีฟอลต์ทุกคนเห็นเฉพาะงานตัวเอง — หัวหน้า/เจ้าของสลับมุมมอง \"ทั้งหมด\" เพิ่มได้เอง)", owner: "own", head: "own", employee: "own" },
      { action: "เห็นสรุปวันลาพนักงานทั้งบริษัท", owner: "full", head: "none", employee: "none" },
    ],
  },
  {
    title: "ห้อง Report",
    rows: [
      { action: "เห็น/โพสต์ในห้อง", note: "canSeeReportTopic — ขึ้นกับที่ห้องนั้นตั้งสิทธิ์ไว้ (ทุกคน / เฉพาะแผนก / เฉพาะผู้บริหาร / เฉพาะบุคคล)", owner: "full", head: "scoped", employee: "scoped" },
      { action: "แก้ไขตั้งค่าห้อง (คัตออฟ จำนวนรูปขั้นต่ำ การมองเห็น)", note: "canEditReportTopic — หัวหน้าแผนกแก้ได้เฉพาะห้องที่ผูกกับแผนกตัวเอง ห้ามแก้ห้องทั้งบริษัท/เฉพาะผู้บริหาร/เฉพาะบุคคล", owner: "full", head: "scoped", employee: "none" },
      { action: "สร้าง/ลบหัวข้อห้องทั้งบริษัท", note: "canManageReportTopics — เจ้าของบริษัท หรือผู้ได้รับมอบสิทธิ์ \"สร้าง/ลบหัวข้อ Report\"", owner: "full", head: "none", employee: "none" },
    ],
  },
  {
    title: "แจ้งปัญหา (Issue Desk)",
    rows: [
      { action: "เปิดตั๋วแจ้งปัญหา", note: "ทุกคนเปิดได้ + ดูตั๋วสาธารณะในบริษัทได้แม้ไม่ใช่ผู้แจ้ง", owner: "full", head: "full", employee: "full" },
      { action: "ดู/จัดการตั๋วทั้งหมด (สถานะ ผู้รับผิดชอบ ทวีความรุนแรง)", note: "isIssueAgent — เฉพาะคนในแผนกที่ตั้งเป็นผู้รับเรื่อง หรือถูกเพิ่มเป็น Agent เสริมเป็นรายคน (ไม่ผูกกับตำแหน่งหัวหน้าแผนก)", owner: "full", head: "none", employee: "none" },
    ],
  },
  {
    title: "หน้าตั้งค่า",
    rows: [
      { action: "จัดการแผนก / พนักงาน / มอบสิทธิ์ตั้งค่าให้รายคน", owner: "full", head: "none", employee: "none" },
      { action: "แจ้งเตือนใกล้ถึงกำหนด (ตั้งค่าทั้งบริษัท)", owner: "full", head: "none", employee: "none" },
      { action: "สติกเกอร์&คะแนน / ไฟล์แนบ / หัวข้อโปรเจค / ประเภทการลา / วันหยุดประจำ", note: "canAccessCompanySection — เจ้าของบริษัทเห็นทุกหมวดเสมอ ส่วนคนอื่นเห็นเฉพาะหมวดที่ถูกมอบสิทธิ์ไว้ที่ \"สิทธิ์การตั้งค่า\" ด้านล่างนี้ (ไม่เกี่ยวกับเป็นหัวหน้าแผนกหรือไม่)", owner: "full", head: "none", employee: "none" },
      { action: "แจ้งปัญหา (ตั้งค่าฝ่ายรับเรื่อง)", note: "เช่นเดียวกับข้างบน — มอบสิทธิ์เป็นรายคนได้แม้ไม่ใช่หัวหน้าแผนก", owner: "full", head: "none", employee: "none" },
    ],
  },
];

export function PermissionGuidePanel() {
  return (
    <div className="rounded-lg border border-[var(--line)] overflow-hidden">
      <div className="p-4 pb-3.5 border-b border-[var(--line)] bg-[var(--bg-soft)]/60">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--brand-green-dark)] shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </span>
          ใครเห็น/ทำอะไรได้บ้าง
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          สรุปสิทธิ์การใช้งานของโมดูล &quot;รายงานและงาน&quot; ตามบทบาท 3 แบบหลัก — ตำแหน่ง (หัวหน้าแผนก) มาจากการตั้งค่าที่ &quot;จัดการแผนก&quot;,
          ส่วนสิทธิ์ตั้งค่าบางหมวดมอบให้เป็นรายคนได้จาก &quot;สิทธิ์การตั้งค่า&quot; โดยไม่ต้องเลื่อนตำแหน่ง
        </p>
      </div>

      <div className="p-4 space-y-6">
        {/* คำอธิบายบทบาท — เปิดก่อนตารางเสมอ เพราะ "หัวหน้าแผนก"/"Agent แจ้งปัญหา"
            ไม่ใช่สิ่งเดียวกับตำแหน่งในองค์กร แต่เป็นค่าที่ตั้งแยกในระบบนี้ */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--line)] p-3">
            <p className="text-sm font-semibold text-[var(--brand-green-dark)]">เจ้าของบริษัท</p>
            <p className="text-xs text-[var(--ink-soft)] mt-1">ตั้งค่าที่โปรไฟล์พนักงานคนนั้น (isOwner) — เห็น/แก้ไขได้ทุกอย่างในทุกแผนก ไม่มีข้อยกเว้น</p>
          </div>
          <div className="rounded-lg border border-[var(--line)] p-3">
            <p className="text-sm font-semibold text-[var(--chart-amber)]">หัวหน้าแผนก</p>
            <p className="text-xs text-[var(--ink-soft)] mt-1">ตั้งได้ที่ ตั้งค่า → สิทธิ์การเข้าถึง → จัดการแผนก (เลือกหัวหน้าแผนกได้ทีละแผนก) — สิทธิ์ครอบคลุมเฉพาะแผนกที่ตนเป็นหัวหน้าเท่านั้น ไม่เห็นแผนกอื่น</p>
          </div>
          <div className="rounded-lg border border-[var(--line)] p-3">
            <p className="text-sm font-semibold">พนักงานทั่วไป</p>
            <p className="text-xs text-[var(--ink-soft)] mt-1">ค่าเริ่มต้นของทุกคน — เห็น/แก้ไขได้เฉพาะงานที่ตัวเองเกี่ยวข้อง (เป็นผู้รับผิดชอบหรือผู้สร้าง)</p>
          </div>
        </div>

        {GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-2">{group.title}</h3>
            <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-soft)]/60 text-[11px] text-[var(--ink-soft)]">
                    <th className="text-left font-medium px-3 py-2 min-w-[220px]">สิ่งที่ทำได้</th>
                    {ROLE_COLUMNS.map((r) => (
                      <th key={r} className="font-medium px-2 py-2 min-w-[140px] text-center">{r}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.action} className="border-t border-[var(--line)]">
                      <td className="px-3 py-2 align-top">
                        <p className="text-[13px] text-[var(--ink)]">{row.action}</p>
                        {row.note && <p className="text-[11px] text-[var(--ink-soft)] mt-0.5">{row.note}</p>}
                      </td>
                      <td className="px-2"><LevelCell level={row.owner} /></td>
                      <td className="px-2"><LevelCell level={row.head} /></td>
                      <td className="px-2"><LevelCell level={row.employee} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="rounded-lg bg-[var(--bg-soft)]/60 border border-[var(--line)] p-3">
          <p className="text-xs text-[var(--ink-soft)]">
            หมายเหตุ: &quot;หัวหน้าฝ่ายรับเรื่องแจ้งปัญหา&quot; กับ &quot;ผู้ได้รับมอบสิทธิ์ตั้งค่าบางหมวด&quot; เป็นสิทธิ์แยกจากตารางนี้ — ไม่ผูกกับตำแหน่งหัวหน้าแผนก
            ตั้งได้ที่ ตั้งค่า → แจ้งปัญหา (เพิ่ม Agent) และ ตั้งค่า → สิทธิ์การเข้าถึง → สิทธิ์การตั้งค่า ตามลำดับ คนคนเดียวรับได้หลายบทบาทพร้อมกัน
            เช่น เป็นพนักงานทั่วไปแต่ได้รับมอบสิทธิ์ดูแลสติกเกอร์&คะแนนได้
          </p>
        </div>
      </div>
    </div>
  );
}
