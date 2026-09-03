# สเปก: "รอบส่ง" — ระบบกำหนดผู้ต้องส่งรายงาน + เวลา + การตัดสินสาย/ไม่ส่ง (report-feed)

> เอกสารนี้เขียนไว้ให้ Claude Code ทำตามได้เลย ทุกหัวข้อมี **ไฟล์ที่เกี่ยว / สภาพปัจจุบัน / สิ่งที่ต้องการ / เกณฑ์ผ่าน**
> repo: `Smartboss` · โมดูล: `apps/web/modules/report_task` (+ อ่านของ `apps/web/lib/performance.ts` เฉยๆ ห้ามแก้)
> เขียนเมื่อ 2026-09-03
>
> **base branch:** ต่อยอดบน `feat/report-room-file-organization` (commit `3ccadeb`) — งานจัดไฟล์ commit นั้นแตะ
> `report-feed-store.ts`, `report-feed-compliance.ts`, `report-topic-panels.tsx` ไว้แล้ว ให้ทำงานนี้บน branch ใหม่
> ที่แตกจาก `3ccadeb` (เช่น `feat/report-submission-rounds`) จะได้ไม่ conflict ตอนรวม main
>
> **ขอบเขตสำคัญ:** งานนี้ทำ **เฟส 1 (A)** ก่อน = ตัดสิน + แสดงผล/แดชบอร์ด **ห้ามแตะระบบหักคะแนน HR**
> (`apps/web/lib/performance.ts`, ตาราง `performance_events`, หน้า `/hr/performance`) เด็ดขาด
> เฟส 2 (เชื่อม HR) เขียนไว้ท้ายเอกสารเป็น "เตรียมโครงให้เปิดทีหลัง" — **ยังไม่เปิดในงานนี้**

---

## 0. บริบท / ปัญหาที่แก้

ห้องรายงาน (report-feed) ปัจจุบันตัดสิน "ใครต้องส่ง" โดย **ผูกติดกับ "ใครเห็นห้อง"**:

> ต้องส่ง = คนที่เห็นห้อง (`canSeeReportTopic`) − เจ้าของบริษัท − คนที่ติ๊กยกเว้น (`visibility.exemptUserIds`)
> — ดู `mustReportToTopic()` ใน `lib/permissions.ts`

ปัญหา 3 ข้อ:

1. **ติ้กตาย** — ห้องที่เปิดให้ "ทุกคนเห็น" แต่จริงๆ ให้ส่งแค่ไม่กี่คน ต้องไปติ๊กยกเว้นคนที่เหลือทั้งหมดทีละคน หลายห้อง = ติ๊กไม่ไหว
2. **ตั้งเวลารายคน/รายกลุ่มไม่ได้** — `cutoffs` กับ `requiredWeekdays` เป็นของทั้งห้อง คนละกลุ่มส่งคนละเวลาไม่ได้
3. **แผนกไม่ตรงกับหน้าที่ส่ง** — คนแผนกเดียวกันส่ง/ไม่ส่งต่างกันได้ จึงเอา "แผนก" มาครอบตรงๆ ไม่ได้

**ทางแก้:** แยก "เห็นห้อง" ออกจาก "ต้องส่ง" อย่างชัดเจน แล้วทำ "ต้องส่ง" เป็นแนวคิดเดียวชื่อ **รอบส่ง (submission round)** ที่รวม *ใคร + กี่โมง + วันไหน* ไว้ในก้อนเดียว ห้องนึงมีได้หลายรอบ

---

## 1. หลักการออกแบบ (ยึดให้ครบ)

1. **2 สวิตช์ต่อห้อง แยกหน้าที่:** (ก) *ใครเห็นห้อง* = `visibility` เดิม ไม่แตะ · (ข) *รอบส่ง* = ของใหม่ คุมว่าใครต้องส่ง+เมื่อไหร่
2. **1 รอบส่ง = ใคร + กี่โมง + วันไหน (+ รูปกี่ใบ)** มัดในก้อนเดียว "คนละเวลา" = คนละรอบ
3. **เลือกผู้ส่งแบบ allowlist ไม่ใช่ blocklist** — เลือก "คนที่ต้องส่ง" ไม่ใช่ "ติ๊กยกเว้นคนที่เหลือ"
4. **ผู้ส่งเลือกได้หลายแบบผสมกัน:** ทุกคนในห้อง / กลุ่มที่ตั้งเอง / แผนก / รายคน + เพิ่ม/ตัดรายคนทับได้
5. **ตัวตัดสินแหล่งเดียว (single decider):** ตรรกะ "ใครสาย/ไม่ส่ง" เขียนที่เดียว ใช้ทั้งการแสดงผล และ (เฟส 2) การหักคะแนน — ห้ามมี logic แสดงกับ logic หักแยกกัน จะเพี้ยน
6. **อิงการลา/วันหยุดจริงเสมอ** — คนลา/หยุดวันนั้น = ไม่นับ ไม่ใช่ตัดสินจากวันในสัปดาห์ตายตัวอย่างเดียว
7. **ของเดิมต้องไม่พัง** — ห้องที่มีอยู่ต้องทำงานเหมือนเดิมโดยไม่ต้อง migrate (ดูข้อ 8)
8. **ไม่แตะ HR ในเฟสนี้** — แดชบอร์ด/สถิติเดิมคงพฤติกรรมไว้ ไม่ยิง event เข้า `performance_events`

---

## 2. โครงข้อมูล

**ไฟล์ที่เกี่ยว:** `apps/web/modules/report_task/store/report-feed-store.ts`,
`apps/web/modules/report_task/lib/db/store-registry.ts`

**สภาพปัจจุบัน:**
- `ReportTopic` มี `cutoffs: ReportCutoff[]` (รอบตัดยอดของทั้งห้อง), `minImages`, `requiredWeekdays?: number[]`,
  `visibility?: ReportTopicVisibility` (มี `departmentIds`, `managerOnly`, `userIds`, `extraUserIds`, `exemptUserIds`)
- `ReportCutoff` = `{ id, label, time "HH:mm", minImages? }`
- state ที่แชร์ทั้งทีมเก็บผ่าน endpoint เดียว `PUT /api/report-task/store/{key}` โดยคีย์ต้องอยู่ใน whitelist ที่ `store-registry.ts`

**สิ่งที่ต้องการ — เพิ่ม type แบบ additive (ห้ามลบ/เปลี่ยนความหมายของเดิม):**

```ts
/** คนที่ต้องส่งในรอบนี้ — เลือกแบบ allowlist ไม่ใช่ ticก ยกเว้น */
export interface SubmitterRule {
  /** everyone = ทุกคนที่เห็นห้อง (canSeeReportTopic) — ค่าเริ่มต้น, เท่าพฤติกรรมเดิม */
  mode: "everyone" | "groups" | "departments" | "people";
  groupIds?: string[];       // ใช้เมื่อ mode = groups (อ้าง SubmitterGroup ด้านล่าง)
  departmentIds?: string[];  // ใช้เมื่อ mode = departments
  userIds?: string[];        // ใช้เมื่อ mode = people
  addUserIds?: string[];     // เพิ่มรายคน "ทับ" ทุก mode
  removeUserIds?: string[];  // ตัดรายคน "ทับ" ทุก mode
}

/** 1 รอบส่งของห้อง — ใคร + กี่โมง + วันไหน + รูปกี่ใบ */
export interface SubmissionRound {
  id: string;
  label: string;            // "กะเช้า"
  time: string;             // "HH:mm" เวลาปิดรอบ (เลยจากนี้ = สาย)
  weekdays?: number[];      // 0=อา..6=ส · undefined/ว่าง = ทุกวัน
  minImages?: number;       // ต่อรอบ · undefined = ใช้ค่า topic.minImages
  submitters: SubmitterRule;
}

/** กลุ่มผู้ส่งที่ตั้งเอง ใช้ซ้ำข้ามห้องได้ — นิยามจาก "หน้าที่ส่ง" ไม่ใช่ผังองค์กร */
export interface SubmitterGroup {
  id: string;
  name: string;             // "เซลหน้าร้าน"
  userIds: string[];
}
```

เพิ่มฟิลด์ใหม่บน `ReportTopic` (optional, backward-compatible):
```ts
submissionRounds?: SubmissionRound[];
```

**กลุ่มผู้ส่ง (SubmitterGroup)** เก็บเป็น store ใหม่:
- เพิ่ม state `submitterGroups: SubmitterGroup[]` + action `upsertSubmitterGroup` / `removeSubmitterGroup`
- เพิ่มคีย์ใหม่ใน `store-registry.ts` (เช่น `"report-submitter-groups"`) ให้ client เขียนได้ — ตามแพตเทิร์นเดิม ไม่ต้องแก้ DB

action ที่ต้องมี/ต่อยอด: ให้ `updateTopicSettings` (ตัวที่ room-settings-sheet ใช้อยู่) รับ `submissionRounds` ได้ด้วย

**เกณฑ์ผ่าน:** typecheck ผ่านทั้ง repo (`pnpm --filter @smartboss/web typecheck`) · ห้องเก่าที่ไม่มี `submissionRounds` ยัง save/load ได้ปกติ · คีย์ใหม่ยิงผ่าน `/api/report-task/store/report-submitter-groups` ได้จริง

---

## 3. ตัวตัดสินแหล่งเดียว (single decider)

**ไฟล์ที่เกี่ยว:** `lib/permissions.ts` (`mustReportToTopic`), `lib/report-feed-compliance.ts`,
`lib/report-cutoff.ts`, `lib/report-topic-membership.ts`, ใหม่: `lib/submission-rounds.ts`

**สภาพปัจจุบัน:**
- `mustReportToTopic(visibility, userId)` = `canSeeReportTopic` − owner − exemptUserIds
- `trackedTopicsOf(topics)` = ห้องที่ `cutoffs.length > 0` เท่านั้นที่ถูกนับสถานะ
- `report-feed-compliance.ts` คำนวณ `ComplianceStatus = on-time|late|missed|pending|exempt` รายคนรายวัน อิง cutoffs + requiredWeekdays + `isExemptDate` (วันลา/หยุด จาก `report-feed-exemptions`)

**สิ่งที่ต้องการ — สร้าง resolver กลางไฟล์ใหม่ `lib/submission-rounds.ts`:**

```ts
// คืนรายชื่อ userId ที่ต้องส่ง "รอบนี้" (ยังไม่คิดวันลา — คิดชั้นบน)
export function resolveRoundSubmitters(
  round: SubmissionRound,
  topic: Pick<ReportTopic, "visibility">,
  users: DirectoryUser[],
  groups: SubmitterGroup[],
): string[]
```
กติกา resolver:
1. ฐานตาม `mode`:
   - `everyone` → ทุก user ที่ `canSeeReportTopic(topic.visibility, id)` เป็นจริง
   - `groups` → union ของ `userIds` ในกลุ่มที่ระบุ
   - `departments` → user ที่ `departmentId` อยู่ใน `round.submitters.departmentIds`
   - `people` → `round.submitters.userIds`
2. บวก `addUserIds`
3. ลบ `removeUserIds` และลบ owner (`isOwner`)
4. **ผู้ส่งต้องเห็นห้องได้เสมอ** — ใครที่ถูกเพิ่มเป็นผู้ส่งแต่ยังไม่อยู่ใน visibility ให้ UI เพิ่มเขาเข้า `visibility.extraUserIds` อัตโนมัติ (จะได้เข้ามาโพสต์ได้จริง) — resolver คืนเฉพาะคนที่เห็นห้องได้

**แก้ `mustReportToTopic` ให้เป็น decider เดียว (รองรับทั้งใหม่และเก่า):**
```
ถ้า topic.submissionRounds มี ≥1 รอบ:
    mustReport = userId ∈ union( resolveRoundSubmitters(ทุกรอบ) )   // ไม่คิดวันในที่นี้
ไม่งั้น (ห้องเก่า):
    ใช้ตรรกะเดิม (canSeeReportTopic − owner − exemptUserIds)
```
> **backward compat สำคัญ:** ห้ามทิ้ง path เดิม ห้องเก่าที่ยังใช้ `cutoffs`/`exemptUserIds` ต้องได้ผลเท่าเดิมเป๊ะ

**แก้ `report-feed-compliance.ts` ให้คิดรายรอบ:**
- `trackedTopicsOf`: ห้องถูกนับถ้ามี `submissionRounds` ≥1 **หรือ** (ของเดิม) `cutoffs.length > 0`
- คำนวณสถานะ **ต่อ (user, รอบ, วัน)**: ในวันนั้นถ้า user ต้องส่งรอบนี้ (อยู่ใน resolver + weekday ของรอบตรง + ไม่ใช่วันลา/หยุด `isExemptDate`) →
  - มีโพสต์ที่เข้าเกณฑ์ก่อน `round.time` และรูปครบ `minImages` → `on-time`
  - มีโพสต์แต่หลัง `round.time` → `late`
  - เลยเวลาปิดรอบแล้วไม่มีโพสต์ → `missed`
  - ยังไม่ถึงเวลาปิดรอบ → `pending`
  - วันลา/หยุด/ไม่ตรง weekday/ไม่อยู่ใน resolver → `exempt` (ไม่นับ)
- ของเดิมที่คิด "ทั้งห้องรายวัน" → ให้ path ห้องเก่า (ไม่มี submissionRounds) ยังทำงานแบบเดิม

**เกณฑ์ผ่าน:**
- ทดสอบด้วย unit test (มีแบบอย่างที่ `lib/*.test.ts`, `lib/report-cutoff.test.ts`): resolver + สถานะรายรอบถูกต้อง รวมเคส เพิ่ม/ตัดรายคน, กลุ่ม, แผนก, วันลา
- ห้องเก่า (ไม่มี submissionRounds) ผลสถานะไม่เปลี่ยนจากเดิม (เขียน test ยืนยัน)

---

## 4. UI จอ 1 — ตั้งค่าห้อง (2 สวิตช์ + รอบส่ง)

**ไฟล์ที่เกี่ยว:** `components/report-feed/report-topic-settings-dialog.tsx`,
`components/report-feed/room-settings-sheet.tsx`, `components/report-feed/room-members-dialog.tsx`

**สภาพปัจจุบัน:** dialog มีเลือก mode การเห็น (ทุกคน/แผนก/บุคคล/หัวหน้า) + จัดการ cutoffs (รอบตัดยอด) +
จัดการสมาชิก/ติ๊กยกเว้น (`exemptUserIds`) ใน `room-members-dialog.tsx`; `requiredWeekdays` ตั้งใน `room-settings-sheet.tsx`

**สิ่งที่ต้องการ:**
- แยกเป็น 2 ส่วนหัวชัดเจน: **"1 · ใครเห็นห้อง"** (mode เดิม ไม่แตะ) และ **"2 · รอบส่ง"**
- ส่วน "รอบส่ง" แสดงเป็น **การ์ดรายรอบ** แต่ละใบโชว์: ชื่อรอบ · ป้ายเวลา "ก่อน HH:MM" · วัน · รูป ≥N ·
  ชิปผู้ส่ง (กลุ่ม/แผนก/คน + ชิปเพิ่ม/ตัดรายคน) · ปุ่มแก้/ลบ
- ปุ่ม **"+ เพิ่มรอบส่ง"** เปิดกล่องจอ 2
- **แถบแม่แบบ (template)** ด้านบนส่วนรอบส่ง: กดแล้วสร้างรอบให้ทั้งชุด (เช่น "กะออฟฟิศ 09:00 จ–ศ", "เช้า-เย็น")
  — ทุกเจ้าดัง (DingTalk/Feishu/Geekbot) เริ่มจากแม่แบบ ลดงานตั้งซ้ำ
- **กล่องสรุป "คนที่ต้องส่งจริง N คน"** ใต้รายการรอบ — คำนวณจาก resolver (รวมทุกรอบ) โชว์เป็นรายชื่อ +
  บรรทัด "คนลา/หยุด วันนั้นระบบไม่นับให้อัตโนมัติ" — กัน config เป็นกล่องดำ
- เว้นว่าง (ไม่มีรอบส่ง) = ห้องนี้ไม่มีใครต้องส่ง ไม่ขึ้นสถานะสาย/ไม่ส่ง (ตรงกับ trackedTopicsOf)
- **ปุ่ม "แปลงรอบตัดยอดเดิมเป็นรอบส่ง"** (ครั้งเดียว): ห้องเก่าที่มี cutoffs กดแล้ว materialize เป็น
  `submissionRounds` (1 รอบต่อ 1 cutoff, submitters = `{mode:"everyone", removeUserIds: exemptUserIds เดิม}`,
  weekdays = requiredWeekdays เดิม) เพื่อให้แก้ผู้ส่งต่อได้ — ไม่บังคับ ไม่กดก็ทำงานแบบเดิม

**เกณฑ์ผ่าน:** เพิ่ม/แก้/ลบรอบได้และ save จริง · ห้องเก่าเปิด dialog ไม่พัง · กล่อง "ต้องส่งจริง" อัปเดตตาม config

---

## 5. UI จอ 2 — กล่องเพิ่ม/แก้รอบส่ง

**ไฟล์ที่เกี่ยว:** ใหม่ `components/report-feed/submission-round-dialog.tsx`

**สิ่งที่ต้องการ (ฟิลด์ตามลำดับ):**
1. **ชื่อรอบ** (text)
2. **ใครต้องส่งรอบนี้** — ตัวเลือก mode (ทุกคนในห้อง / กลุ่ม / แผนก / รายคน) + picker:
   - picker มีแท็บ **กลุ่ม / แผนก / รายคน** + ช่องค้นหา (แพตเทิร์นเดียวกับ DingTalk/Feishu: tree/checkbox + ช่องที่เลือก)
   - โซน **"เพิ่มรายคน"** และ **"ยกเว้นรายคน (แยกให้เห็นชัด)"** — อย่าซ่อนคนที่ตัดออกในกองชิปรวม
   - ปุ่มลัด "สร้างกลุ่มใหม่จากคนที่เลือก" (เขียนลง submitterGroups)
3. **ส่งก่อนเวลา** (time picker "HH:mm")
4. **รูปขั้นต่ำ** (stepper, default = ค่าห้อง)
5. **วันที่ต้องส่ง** (ปุ่มวัน อา–ส, ว่าง = ทุกวัน) + บรรทัด "วันหยุด/วันลา ตัดออกให้เองตามปฏิทิน HR"

**เกณฑ์ผ่าน:** เลือกผสม (กลุ่ม+เพิ่ม/ตัดคน) ได้ · เวลาต่างรอบได้ · save เข้า `submissionRounds` ถูกต้อง · คนที่เพิ่มเป็นผู้ส่งแต่ไม่เห็นห้อง ถูกเพิ่มเข้า `visibility.extraUserIds` ให้อัตโนมัติ

---

## 6. UI จอ 3 — หน้าสรุปการส่ง (ใหม่)

**ไฟล์ที่เกี่ยว:** ใหม่ใต้ `app/(shell)/report-task/...` (เช่นแท็บ "สรุป" ในห้อง หรือหน้า `report-feed/summary`),
ต่อยอด `components/report-feed/report-topic-panels.tsx` (แท็บสถิติเดิม), `lib/report-feed-compliance.ts`

**สภาพปัจจุบัน:** มีสถิติ ตรงเวลา/สาย/ไม่ส่ง ในห้อง + การ์ดบนแดชบอร์ด (`report-feed-pending-today-card`,
`report-feed-status-pie`, `system-kpi-summary`) ทั้งหมดคำนวณฝั่ง client จาก compliance — **คงไว้ ไม่แตะพฤติกรรม**

**สิ่งที่ต้องการ (จอใหม่ที่เจ้าดังลงแรงที่สุด):**
- **มุมมองวันนี้:** รายชื่อผู้ต้องส่ง + ป้ายสถานะ (ส่งแล้ว/สาย/ไม่ส่ง/รอ) แยกตามรอบ +
  ปุ่ม **"จี้คนที่ยังไม่ส่ง"** (จำกัดความถี่ เช่นทุก 5 ชม./คน กันสแปม แบบ Geekbot) — เฟสนี้แค่ UI/สถานะ
  การส่งเตือนจริงต่อกับ `remindBeforeCutoffMinutes`/`notifyManagerSummary` ที่มีฟิลด์อยู่แล้วได้ภายหลัง
- **มุมมองย้อนหลัง:** กราฟ % การส่งของทีม + **"% การส่งรายคน" (Report Rate)** ตามช่วงเวลา (ตัวชี้วัดความรับผิดชอบ)
- **ป้าย shadow "จะหัก −N"** ต่อเคส late/missed — โชว์ว่า *ถ้าเปิดหัก* คนนี้จะโดนเท่าไหร่ (อ่านค่าจาก
  `loadPerformanceSettings` แบบ read-only เพื่อโชว์ตัวเลขเท่านั้น **ห้ามเขียน event**) — ให้หัวหน้าตรวจความแม่นก่อนเปิดจริง
- filter: วันที่ / แผนก / ห้อง / รอบ / สถานะ / คน + ปุ่ม export (ตามที่ DingTalk/Feishu มี)

**เกณฑ์ผ่าน:** จอสรุปโชว์สถานะรายรอบถูกต้องตาม decider · shadow โชว์ตัวเลขโดยไม่มีการเขียน `performance_events` (ยืนยันด้วยการ grep ว่าไม่มี import/เรียก `recordPerformanceEvents` ในโค้ดเฟสนี้) · แดชบอร์ดเดิมยังทำงานเหมือนเดิม

---

## 7. เฟส 2 (เตรียมโครงไว้ — ยังไม่เปิดในงานนี้) เชื่อม HR

> **ห้ามทำในงานนี้** เขียนไว้ให้ตัว decider เฟส 1 ออกแบบมาแล้วต่อยอดง่าย

- ทำ sweep ปิดรอบ (แบบ `app/api/report-task/tasks/sweep/route.ts`): ต่อบริษัท/ห้อง/รอบ/วัน หา "ผู้ต้องส่ง" (จาก decider เดียวกัน, คิดวันลาแล้ว) → late/missed → เรียก `recordPerformanceEvents()` ที่มีอยู่
- category `report_late` / `report_missed` (มีใน `PERFORMANCE_CATEGORIES` แล้ว), แต้มมาจาก `performance_settings`
- **refId มาตรฐาน** `${reportDate}:${topicId}:${roundId}:${userId}` (สูตรเดียวกับที่ Discord เคยใช้) → dedup กันหักซ้ำ
- สวิตช์เปิด/ปิดต่อบริษัท (`reportPenaltyEnabled` ใหม่) + เคารพ `performance_settings.enabled`
- **ห้ามแก้** `apps/web/lib/performance.ts` / schema / หน้า HR — แค่ "เรียกใช้" ฟังก์ชันเดิม
- มาส่งทีหลังหลัง missed → ต้องมีทางถอน/แก้ event (ตัดสินนโยบายตอนทำเฟส 2)
- อาจมี grace ("เตือนก่อน N ครั้งค่อยหัก") ให้ดูไม่โหด

---

## 8. Backward compat / อย่าทำพัง (สำคัญ)

- ห้องที่ไม่มี `submissionRounds` = ใช้ path เดิมทุกอย่าง (cutoffs/requiredWeekdays/exemptUserIds) — เขียน test ยืนยันผลไม่เปลี่ยน
- งานจัดไฟล์ (`3ccadeb`) แก้ `report-feed-compliance.ts` ให้ **minImages/"แนบรูปไม่ครบ" นับเฉพาะรูป/คลิป ไม่นับ pdf/เอกสาร** — decider ใหม่ต้องคงกติกานี้ (นับรูปจริงเท่านั้น)
- ลิงก์ deep-link เดิมของแดชบอร์ด (`trackedTopicIdForDepartment` ฯลฯ) ต้องยังทำงาน
- **Discord ถอดออกแล้ว** — ระวังอย่าไปพึ่ง/ปลุก path ของ `api/report-task/discord-ingest` (ถ้าจะเก็บกวาดโค้ด discord ที่ตายแล้ว แยกเป็นอีก PR ต่างหาก อย่าปนกับงานนี้)
- หน้าโมดูลนี้เป็น client component เกือบหมด — **curl ได้ 200 ไม่ได้แปลว่าไม่พัง** ต้องเปิดเบราว์เซอร์จริงแล้วดู console (แดชบอร์ด/ห้อง/ตั้งค่า) ระวัง hydration warning (ดู `docs/report_task_port.md` หัวข้อ "ตรวจด้วย curl อย่างเดียวไม่พอ")

---

## 9. ความเสี่ยง + วิธีรับมือ (ให้ทำตามตั้งแต่ออกแบบ)

| ความเสี่ยง | วิธีรับมือ |
|---|---|
| หักคนที่ลา/หยุด | decider เช็ค `isExemptDate` (วันลา/หยุด) ก่อนตัดสิน missed เสมอ |
| แสดงผลกับ (อนาคต) หัก เพี้ยนกัน | ใช้ decider แหล่งเดียว (`lib/submission-rounds.ts` + compliance) ทั้งสองทาง |
| config เป็นกล่องดำ ตอบไม่ได้ว่าใครต้องส่ง | กล่อง "คนที่ต้องส่งจริง N คน" ที่คำนวณให้เห็น (จอ 1) |
| ผู้ส่งไม่เห็นห้อง เลยโพสต์ไม่ได้ | เพิ่มเข้า `visibility.extraUserIds` อัตโนมัติเมื่อเพิ่มเป็นผู้ส่ง |
| ของเดิมพัง | path ห้องเก่าแยกไว้ + unit test ยืนยันผลเท่าเดิม |
| สองรอบชนกัน (คนเดียวโดนซ้ำในวันเดียว) | คิดสถานะต่อ (user,รอบ,วัน) — คนละรอบคือคนละภาระ ตั้งใจให้ซ้ำได้ แต่ dedup ที่ refId ระดับรอบ (เฟส 2) |

---

## 10. แผนเฟส + เกณฑ์ผ่านรวม

**เฟส 1 (งานนี้):** ข้อ 2–6 + 8–9
- [ ] type + store + registry (ข้อ 2)
- [ ] resolver + decider เดียว + compliance รายรอบ + tests (ข้อ 3)
- [ ] UI จอ 1 (2 สวิตช์ + การ์ดรอบ + แม่แบบ + กล่องต้องส่งจริง + ปุ่มแปลง)
- [ ] UI จอ 2 (กล่องเพิ่ม/แก้รอบ + picker กลุ่ม/แผนก/คน + เพิ่ม/ตัด)
- [ ] UI จอ 3 (หน้าสรุป: วันนี้ + ย้อนหลัง + shadow "จะหัก" read-only + filter/export)
- [ ] `pnpm --filter @smartboss/web typecheck` ผ่าน + lint ผ่าน + unit tests ผ่าน
- [ ] เปิดเบราว์เซอร์จริง เช็ค console: แดชบอร์ด/ห้อง/ตั้งค่า/หน้าสรุป ไม่มี error
- [ ] ยืนยันไม่มีการเรียก `recordPerformanceEvents` จากโค้ดเฟสนี้ (grep)

**เฟส 2 (แยกออกไป):** ข้อ 7 — เปิดการหักเข้า HR หลัง shadow นิ่ง

---

## 11. หมายเหตุการทำงานร่วม repo

- ทำบน branch ใหม่แตกจาก `feat/report-room-file-organization` (3ccadeb) ชื่อ `feat/report-submission-rounds`
- commit เป็นช่วงย่อยๆ (type → decider → จอ1 → จอ2 → จอ3) จะได้ review/rollback ง่าย
- ปิด Claude Code session อื่นที่เปิด `d:\Smartboss` ขณะทำ (working dir เดียวกันแย่งไฟล์กัน)
- ต่อท้าย commit ตามธรรมเนียม repo · เสร็จแล้วส่งสรุป diff + ผล typecheck/test กลับมาให้รีวิว
