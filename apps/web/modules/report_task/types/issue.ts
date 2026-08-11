// Types for the issue-report / support-desk system (ISSUE_REPORT_SYSTEM_SPEC.md).
// Split out of src/types/index.ts because this module has its own large,
// self-contained domain (ticket state machine + threaded messages) — folding
// it into the main file would make that one unreadably long.

export type IssueCategory =
  | "bug" // ใช้งานไม่ได้ / error
  | "ui" // หน้าตา, layout, ข้อความผิด
  | "data" // ข้อมูลผิด/หาย/ซ้ำ
  | "performance" // ช้า, ค้าง
  | "access" // สิทธิ์เข้าไม่ได้, ลืมรหัส
  | "how_to" // ถามวิธีใช้ (ไม่ใช่บั๊ก)
  | "feature" // ขอฟีเจอร์เพิ่ม
  | "other";

/** ผู้แจ้งเลือก "ผลกระทบ" ไม่ใช่ "ความสำคัญ" — คนแจ้งประเมิน priority ไม่ได้
 *  แต่ประเมินได้ว่าตัวเองทำงานต่อได้ไหม Agent เป็นคนแปลงเป็น priority จริง */
export type IssueImpact =
  | "blocked" // ทำงานต่อไม่ได้เลย
  | "workaround" // มีทางเลี่ยง แต่เสียเวลา
  | "minor"; // แค่รำคาญ / ความสวยงาม

export type IssuePriority = "urgent" | "high" | "normal" | "low";

export type IssueStatus =
  | "new" // ยังไม่มีใครรับ
  | "triaged" // Agent รับเรื่อง + จัด priority แล้ว
  | "in_progress" // Agent กำลังแก้เอง
  | "waiting_reporter" // รอผู้แจ้งตอบ/ให้ข้อมูลเพิ่ม (นาฬิกา SLA หยุดเดิน — เฟส 2)
  | "escalated" // ส่งให้ผู้พัฒนาแล้ว รอรับเรื่อง
  | "vendor_working" // กำลังทำอยู่ฝั่งผู้พัฒนา
  | "vendor_released" // ผู้พัฒนาแจ้งว่าแก้แล้ว/ขึ้น production แล้ว
  | "pending_verify" // รอผู้แจ้งยืนยันว่าใช้ได้จริง
  | "resolved" // ยืนยันแล้ว จบ
  | "rejected" // ไม่ใช่ปัญหา / ทำไม่ได้ (ต้องมี reason)
  | "duplicate"; // ซ้ำกับตั๋วอื่น (ต้องมี duplicateOfId)

/** Terminal states — a ticket here needs a fresh one (or a reopen) to move again. */
export const CLOSED_STATUSES: IssueStatus[] = ["resolved", "rejected", "duplicate"];

/** Ticket must have passed through `triaged` before it can be escalated — this is
 * the set of statuses reachable only after triage, used by canEscalateIssue. */
export const POST_TRIAGE_STATUSES: IssueStatus[] = ["triaged", "in_progress", "waiting_reporter"];

export interface IssueTicket {
  id: string;
  /** เลขตั๋วอ่านง่ายสำหรับอ้างอิงทางโทรศัพท์/ไลน์ เช่น "IS-0142" */
  code: string;

  reporterId: string;
  category: IssueCategory;
  title: string;
  description: string;
  impact: IssueImpact;

  status: IssueStatus;
  priority: IssuePriority; // default มาจาก impact + category, Agent แก้ได้
  assigneeId: string | null; // Agent ที่รับผิดชอบ
  vendorAssigneeId: string | null; // ยังไม่มีบัญชี vendor จริงในเฟส 1 — สงวนไว้สำหรับเฟส 3

  /** ใครเห็นตั๋วนี้ได้บ้างในองค์กร */
  visibility: "private" | "public_in_org";

  /** ให้หัวหน้าแผนกของผู้แจ้งเห็น หัวข้อ+สถานะ+อายุตั๋ว ใน "ของทีมฉัน" ได้ไหม — ไม่ใช่
   * สิทธิ์เต็ม หัวหน้ายังอ่านแชท/โน้ตภายในไม่ได้แม้ค่านี้เป็น true (ดู
   * canSeeIssueSummaryAsHead ใน permissions.ts) ผู้แจ้งปลดออกได้เอง —
   * ค่าเริ่มต้นในฟอร์มมาจาก category (หมวด "สิทธิ์เข้าไม่ได้" เริ่มเป็น false
   * เพราะมักพาดพิงเรื่องส่วนตัว) ดู ISSUE_DESK_AUDIT_2026-08-08.md §C3. */
  shareWithHead: boolean;

  /** context ที่เก็บอัตโนมัติ ไม่ให้ผู้ใช้พิมพ์ */
  context: {
    pageUrl: string;
    userAgent: string;
    viewport: string; // "1440x900"
    appVersion: string; // commit sha / build id จาก env — "dev" นอก production build
    occurredAt: string;
  };

  attachments: IssueAttachment[]; // ไฟล์แนบตอนแจ้ง (ในข้อความมีของตัวเองแยกอีกที)
  messages: IssueMessage[]; // แชท + event log รวมกัน

  duplicateOfId: string | null;
  rejectReason: string | null;
  tags: string[]; // Agent ติดเอง เช่น "โมดูลปฏิทิน"

  /** สิ่งที่ Agent ตรวจสอบแล้วก่อน escalate — บังคับกรอกตอน escalate (กันโยนงานดิบ) */
  whatWasChecked: string | null;

  createdAt: string;
  firstResponseAt: string | null; // เวลาที่ Agent ตอบ/รับเรื่องครั้งแรก
  escalatedAt: string | null;
  escalatedBy: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  updatedAt: string;

  /** จำนวนครั้งที่ถูกเปิดกลับหลัง resolved (reporter กด "ยังไม่หาย") */
  reopenCount: number;

  /** ผู้แจ้งให้คะแนนหลังปิดงาน 1-5 (optional, เฟส 2 ค่อยเปิดใช้ใน UI) */
  satisfaction: number | null;
}

export type IssueMessageKind = "message" | "event";

/** ใครอ่านข้อความนี้ได้
 *  all    = ทุกคนที่เห็นตั๋ว (รวมผู้แจ้ง)
 *  staff  = Agent + Owner เท่านั้น (โน้ตภายใน ผู้แจ้งไม่เห็น)
 *  vendor = Agent + Owner + Vendor (ช่องคุยกับผู้พัฒนา ผู้แจ้งไม่เห็น — ยังไม่มี UI ในเฟส 1) */
export type IssueAudience = "all" | "staff" | "vendor";

export interface IssueMessageEvent {
  type:
    | "status_changed"
    | "assigned"
    | "escalated"
    | "priority_changed"
    | "merged"
    | "reopened"
    | "verified";
  from?: string;
  to?: string;
}

export interface IssueMessage {
  id: string;
  kind: IssueMessageKind;
  authorId: string;
  audience: IssueAudience;
  body: string; // สำหรับ event = ข้อความสรุปที่ generate ไว้
  event?: IssueMessageEvent; // สำหรับ kind === "event" — เลือกไอคอน/สีจากนี้ ไม่ต้อง parse ข้อความ
  attachments: IssueAttachment[];
  createdAt: string;
  editedAt: string | null;
  /** ใครอ่านแล้วบ้าง — ใช้ทำ unread badge ต่อห้อง/ต่อตั๋ว */
  readBy: string[];
}

export interface IssueAttachment {
  id: string;
  name: string;
  size: number; // bytes
  mime: string;
  url: string; // จาก /api/uploads
  /** ตั้งเป็น true เมื่อ mime ขึ้นต้น image/ → render inline */
  isPreviewable: boolean;
  uploadedBy: string;
  uploadedAt: string;
}

export interface IssueDeskConfig {
  /** แผนกที่รับเรื่อง (Agent) */
  recipientDepartmentIds: string[];
  /** Agent เพิ่มเติมที่ไม่ได้อยู่ในแผนกนั้น */
  extraAgentUserIds: string[];
  /** เปิด/ปิดหมวดหมู่ ไม่ให้ฟอร์มยาวเกินจำเป็น */
  enabledCategories: IssueCategory[];
  /** ข้อความ "ปัญหาที่รู้อยู่แล้ว" ปักหมุดบนหน้าแจ้ง กันแจ้งซ้ำ */
  knownIssuesBanner: { active: boolean; text: string; updatedAt: string } | null;
}

export const ALL_ISSUE_CATEGORIES: IssueCategory[] = [
  "bug",
  "ui",
  "data",
  "performance",
  "access",
  "how_to",
  "feature",
  "other",
];
