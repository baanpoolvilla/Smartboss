# SmartBoss — รวมการตั้งค่า "รอบส่งรายงาน" ให้เหลือระบบเดียว (ลบรอบตัดยอด + วันที่ต้องส่ง)

> สเปกแยกเฉพาะเรื่องนี้ สำหรับส่งให้ **Claude Code ใน VS Code** ทำต่อ
> อ่านทั้งไฟล์ก่อนเริ่ม ทำตามลำดับขั้น และผ่าน `pnpm typecheck` + `pnpm lint` ก่อนถือว่าเสร็จ

วันที่: 2026-09-04
โมดูล: `apps/web/modules/report_task` (ระบบ Report Feed / ห้องรายงาน)

---

## เป้าหมาย (จากเจ้าของงาน)

ในหน้า **"ตั้งค่าห้อง report"** ตอนนี้มีการตั้งค่าที่ทับซ้อนกับ "เพิ่มรอบส่ง" อยู่ **3 ช่องระดับห้อง**:
1. **รอบตัดยอดรีพอต** (`cutoffs`) — เก็บแค่ "เวลา"
2. **วันที่ต้องส่งรายงาน** (`requiredWeekdays`) — เก็บแค่ "วัน"
3. **จำนวนรูปขั้นต่ำต่อโพสต์ (ค่าเริ่มต้น)** (`minImages`) — เก็บ "จำนวนรูปขั้นต่ำ" ระดับห้อง

ทั้งหมดนี้ **"เพิ่มรอบส่ง"** (`submissionRounds`) มีครบในตัวอยู่แล้ว: **ใครต้องส่ง + เวลา (ส่งก่อนเวลา) + วัน (วันที่ต้องส่ง) + รูปขั้นต่ำ (ต่อรอบ)**

**ต้องการ (ยืนยันจากเจ้าของงาน):** เอา **ทั้ง 3 ช่องระดับห้องออก** แล้วให้ตั้งทุกอย่างที่ **"เพิ่มรอบส่ง" ที่เดียว** — เหลือระบบเดียว

**การตัดสินใจสำคัญเรื่องรูปขั้นต่ำ:** ไม่ต้องมี "ค่าเริ่มต้นระดับห้อง" อีกต่อไป — ให้ตั้งรูปขั้นต่ำ **ต่อรอบ** เท่านั้น และ **ห้องที่ไม่มีรอบส่งเลย = ไม่บังคับแนบรูป** (รูปขั้นต่ำ = 0) นี่เป็นพฤติกรรมที่เจ้าของงานต้องการโดยตรง

**ทำได้ไหม? — ได้** และเป็นทิศทางที่โค้ดวางไว้อยู่แล้ว: มี `effectiveRoundsOf()` (`lib/submission-rounds.ts`) ที่ "แปลงร่าง" legacy (`cutoffs + requiredWeekdays + exemptUserIds`) เป็นรอบส่งให้เท่าพฤติกรรมเดิมอยู่แล้ว และ UI ก็ซ่อน 2 ช่องนี้เมื่อมีรอบส่งแล้ว งานนี้แค่ทำให้ "รอบส่ง" เป็นทางเดียวจริง ๆ

---

## สถาปัตยกรรมปัจจุบัน (อ่านให้เข้าใจก่อนแก้)

- **แหล่งความจริงเดียวของ "ใครต้องส่งเมื่อไหร่"** คือ `effectiveRoundsOf(topic)` ใน `lib/submission-rounds.ts`
  - ถ้า `topic.submissionRounds` มีของ → ใช้ตามนั้น
  - ถ้าไม่มี (ห้องเก่า) → สังเคราะห์รอบจาก `cutoffs` (เวลา+รูป) + `requiredWeekdays` (วัน) + `visibility.exemptUserIds` (คนยกเว้น) ให้ 1 cutoff = 1 รอบ ผู้ส่ง = "ทุกคนที่เห็นห้อง ลบคนยกเว้น"
- ตัวตัดสิน/แสดงผลส่วนใหญ่เรียกผ่าน `effectiveRoundsOf` / `cutoffsOnDay` แล้ว (ดูคอมเมนต์ใน `lib/report-cutoff.ts`)
- UI ตั้งค่าอยู่ 2 ที่ (ใช้ component ร่วมกัน):
  - `components/report-feed/room-settings-sheet.tsx` (ชีทตั้งค่าห้อง — ที่เห็นในภาพ)
  - `components/report-feed/report-topic-settings-dialog.tsx` (หน้า settings + reused ในชีท)
  - ทั้งคู่ **ซ่อน** รอบตัดยอด/วันที่ต้องส่งอยู่แล้วเมื่อ `submissionRounds.length > 0` (guard `rounds.length === 0` / `(draft.submissionRounds?.length ?? 0) === 0`)

**สรุปกลไก:** ที่ยังเห็น 2 ช่องในภาพ เพราะห้องนั้น **ยังไม่มี submissionRounds เลย** → พอทำให้ทุกห้องมี submissionRounds (migrate) + ลบ UI legacy ออก ก็จบ

---

## แผนงาน (4 ขั้น — ทำตามลำดับ)

### ขั้นที่ 1 — Auto-migrate ทุกห้องเป็น `submissionRounds` ตอนโหลด
ทำให้ห้องเก่าที่มี `cutoffs`/`requiredWeekdays` แต่ยังไม่มี `submissionRounds` ถูกแปลงเป็น `submissionRounds` อัตโนมัติ เพื่อให้เมื่อเราลบ UI legacy แล้ว ห้องเก่ายังแก้ตารางได้ (ผ่านรอบส่ง)

- จุดที่เหมาะ: `normalizeReportFeedSlice` (ดู `store/report-feed-store.ts` — ถูกเรียกตอน hydrate ใน `store-hydrator.tsx` อยู่แล้ว) เพิ่มขั้น: ถ้า topic ใดมี `(submissionRounds?.length ?? 0) === 0` และ `cutoffs.length > 0` → เซ็ต `submissionRounds = effectiveRoundsOf(topic)` (มีฟังก์ชันแปลงพร้อมใช้)
- ใช้ตรรกะเดียวกับ `convertLegacy()` ที่มีอยู่ใน `report-topic-settings-dialog.tsx` (map cutoffs → rounds, weekdays = requiredWeekdays, submitters = everyone ลบ exemptUserIds) — พิจารณาย้าย `convertLegacy` มาเป็น util กลางใน `lib/submission-rounds.ts` แล้วเรียกใช้ทั้ง 2 ที่ ไม่ให้ตรรกะแตกกัน
- **รูปขั้นต่ำ:** แต่ละรอบที่ migrate มาต้อง set `minImages = cutoff.minImages ?? topic.minImages` (คงพฤติกรรมเดิม — ห้องที่เคยตั้งค่าเริ่มต้น 2 รูป รอบที่แปลงมาต้องได้ 2 เท่ากัน) — `effectiveRoundsOf` เดิม map ไว้แค่ `c.minImages` ตรง ๆ ซึ่ง **ยังไม่รวม default ของห้อง** ต้องเติม `?? topic.minImages` ตอน migrate เพื่อไม่ให้ห้องที่พึ่ง default หลุดข้อกำหนดรูป
- **สำคัญ:** อย่าให้ migration ตัดสิน "พลาดส่ง" ย้อนหลัง — รอบที่สร้างจาก migration **ไม่ต้องใส่ `createdAt`** (ปล่อย undefined) เพื่อให้ `roundRunsOnDay` เดินพฤติกรรมเดิม (ดูคอมเมนต์ `roundRunsOnDay` — createdAt ไว้กันตัดสินย้อนหลังของรอบที่เพิ่งเพิ่มใหม่เท่านั้น)
- migration ต้อง **idempotent** (รันซ้ำแล้วไม่เพิ่มรอบซ้ำ) — เช็ค `submissionRounds` ว่างก่อนแปลงเท่านั้น

> ทางเลือก: ถ้าไม่อยากเขียนทับข้อมูลตอนโหลด อาจทำ migration เป็นสคริปต์ครั้งเดียว (backfill) แทน แต่ auto-migrate ตอนโหลดทำได้เนียนกว่าและไม่ต้องแตะ DB ตรง ๆ

### ขั้นที่ 2 — ลบ UI ของ "รอบตัดยอด" + "วันที่ต้องส่งรายงาน" ออก
หลังขั้น 1 ทุกห้องมี `submissionRounds` แล้ว จึงลบ 2 ช่องนี้ได้อย่างปลอดภัย

- `components/report-feed/report-topic-settings-dialog.tsx`
  - ลบทั้งบล็อก **"รอบตัดยอดรีพอต"** (ส่วนที่ครอบด้วย `{rounds.length === 0 && (...)}` — comment "B") รวม state/handler ที่ใช้เฉพาะมัน: `newLabel`, `newTime`, `addCutoff`, `removeCutoff`, `setCutoffMinImages`
  - ลบปุ่ม **"แปลงรอบตัดยอดเดิม (N) เป็นรอบส่ง"** (`convertLegacy` — ไม่ต้องแล้วเพราะ auto-migrate ทำให้ตั้งแต่โหลด) — หรือคงไว้เป็น safety ก็ได้ แต่จะไม่มีวันแสดงเพราะ rounds จะไม่ว่างแล้ว
  - ทำให้ "รอบส่ง" เป็น section หลักเสมอ (ไม่ต้องมีเงื่อนไข legacy)
  - ลบบล็อก **"จำนวนรูปขั้นต่ำต่อโพสต์ (ค่าเริ่มต้น)"** (`ImageCountStepper value={topic.minImages}` + ข้อความอธิบาย ~บรรทัด 292–305) — ไม่มี default ระดับห้องอีกต่อไป
- `components/report-feed/room-settings-sheet.tsx`
  - ลบบล็อก **"วันที่ต้องส่งรายงาน"** (ส่วนที่ครอบด้วย `{(draft.submissionRounds?.length ?? 0) === 0 && (...)}`, ~บรรทัด 285–320) รวม handler ปุ่มวัน (`requiredWeekdays` toggle, ~บรรทัด 189–197)
  - ลบ **"จำนวนรูปขั้นต่ำ"** ระดับห้อง และ label map `requiredWeekdays`/`cutoffs`/`minImages` (~บรรทัด 82, 88, 89) ถ้าไม่ถูกใช้ที่อื่นแล้ว
- `components/report-feed/submission-round-dialog.tsx` (กล่อง "เพิ่มรอบส่ง")
  - ช่อง "รูปขั้นต่ำ" ต่อรอบ **มีอยู่แล้ว** — ทำให้มันเป็น plain value ค่าเริ่มต้น `0` (ไม่ inherit จากห้อง) และ **ตัด prop `roomDefaultMinImages` ออก** (ปัจจุบัน `report-topic-settings-dialog.tsx:451` ส่ง `roomDefaultMinImages={topic.minImages}` เข้ามา — เอาออก)
- ตรวจว่าไม่มี dead import/ตัวแปรค้าง (`Trash2`, `ImagePlus`, `ImageCountStepper`, ฯลฯ ที่ใช้เฉพาะบล็อกที่ลบ)

### ขั้นที่ 3 — ให้ทุกจุดที่ยังอ่าน `topic.cutoffs` ตรง ๆ อ่านผ่านตัวรวม
จุดพวกนี้ยังอ้าง `topic.cutoffs` โดยตรง ถ้าห้องใช้รอบส่งอย่างเดียว (หลัง migrate `cutoffs` อาจยังมีของเก่าค้าง แต่ไม่ควรพึ่ง) ให้เปลี่ยนไปอ่านผ่าน `effectiveRoundsOf(topic)` / `cutoffsOnDay(topic, day)` เพื่อผลลัพธ์ตรงกันทุกที่:

- `app/(shell)/report-task/report-feed/page.tsx` — บรรทัด ~434, 437, 446–449, 466, 754, 776 (ส่วนหัวตาราง "เวลาส่ง" / สรุปรอบ) → ใช้ `effectiveRoundsOf(activeTopic)` แทน `activeTopic.cutoffs`
- `components/report-feed/report-topic-panels.tsx:290` — `hasSchedule = topic.cutoffs.length > 0` → `hasSchedule = effectiveRoundsOf(topic).length > 0`
- `lib/report-cutoff.ts` — `minImagesNow(topic)` ปัจจุบันอ่าน `topic.cutoffs` ตรง ๆ (บั๊กเดิม: ห้องที่ใช้รอบส่งอย่างเดียวจะได้ค่าผิด) → ให้รับ/ใช้ effective rounds ของวันนั้นแทน
- `lib/reminder-sweep.ts:171` — `lastCutoffMinutesOf(topic.cutoffs)` → ใช้ effective rounds
- `lib/report-feed-compliance.ts` — บรรทัด ~41, 101 ยังอ้าง `topic.cutoffs` (บรรทัด 25 เช็คทั้งสองแล้ว, บรรทัด 57 คอมเมนต์ว่าเป็น legacy path) → ปรับให้เดินผ่าน effective rounds ทางเดียว

**และจุดที่อ่าน `topic.minImages` ระดับห้อง (ต้องเลิกใช้ default ระดับห้อง → ใช้ต่อรอบ, ไม่มีรอบ = 0):**
- `lib/report-cutoff.ts` — `minImagesNow(topic)` เปลี่ยนจาก `round?.minImages ?? topic.minImages` เป็น **`currentRound?.minImages ?? 0`** (อิง effective round ของตอนนี้; ไม่มีรอบ = 0)
- `components/report-feed/report-composer.tsx:177` — `activeRound?.minImages ?? topic.minImages` → **`activeRound?.minImages ?? 0`**
- `components/report-feed/report-card.tsx:1718` — เลิกส่ง `minImages: topic.minImages` เข้า `minImagesNow`; ให้คิดจาก effective round อย่างเดียว
- `app/(shell)/report-task/report-feed/page.tsx:435,438` — ข้อความสรุป "แนบอย่างน้อย N รูปทุกโพสต์" (อิง `activeTopic.minImages`) และ `requiredOf` (`c.minImages ?? activeTopic.minImages`) → อิงรูปขั้นต่ำของแต่ละรอบแทน (ไม่มี default ห้อง)
- `components/report-feed/report-topic-settings-dialog.tsx:408` — การ์ดสรุปรอบ `r.minImages ?? topic.minImages` → **`r.minImages ?? 0`**
> **ระวัง:** ห้องที่ **ไม่มีรอบ** ต้องได้ `minImagesRequired = 0` (โพสต์ได้โดยไม่ต้องแนบรูป) — นี่คือพฤติกรรมที่ยืนยันแล้วว่าต้องการ (รูปผูกกับรอบเท่านั้น)

> เกณฑ์ตรวจ: `grep -rn "\.cutoffs\|topic.minImages\|requiredWeekdays" apps/web/modules/report_task apps/web/app` แล้ว **ในบริบท report-feed** (ไม่รวม Discord) เหลืออ้างเฉพาะภายใน `submission-rounds.ts` / `report-cutoff.ts` / `report-feed-store.ts` (นิยาม/ตัวแปลง/migration) เท่านั้น จุดผู้บริโภคอื่นผ่านตัวรวม/รอบหมด

### ขั้นที่ 4 (ทำภายหลัง / ทางเลือก) — ลบ field legacy ออกจาก type + DB
เมื่อมั่นใจว่าไม่มีใครอ่าน `cutoffs`/`requiredWeekdays`/`minImages` ระดับห้องตรง ๆ แล้ว ค่อยลบ field ออกจาก `ReportTopic` (`store/report-feed-store.ts`) และปรับ `effectiveRoundsOf` ให้คืน `submissionRounds` อย่างเดียว
- **ยังไม่ต้องทำในรอบแรก** — เก็บ field ไว้เป็น back-compat ก่อน (ข้อมูลเก่าใน DB ยังมี) ลบเมื่อแน่ใจว่า migrate ครบทุก org แล้ว

---

## ⚠️ จุดที่ต้องระวัง (อย่าพลาด)

### 1. `exemptUserIds` มี 2 หน้าที่ — อย่าลบเพลิน
`visibility.exemptUserIds` ใช้ทั้ง:
- **(ก) การมองเห็นห้อง** — `lib/permissions.ts` (exempt = ไม่เห็นห้อง) และ `lib/ai-insight/aggregate.ts` ยังใช้อยู่ → **ต้องคงไว้**
- **(ข) "ไม่ต้องส่ง" ของ legacy** — ส่วนนี้ในระบบใหม่ถูกแทนด้วย `round.submitters.removeUserIds` แล้ว
- การจัดการ exempt อยู่ที่ `components/report-feed/room-members-dialog.tsx` (การจัดสมาชิก/ยกเว้น) — **อย่าไปแตะ** ในงานนี้ มันคนละเรื่องกับ "รอบส่ง"
- migration ต้อง map `exemptUserIds` → `removeUserIds` ของรอบ (convertLegacy ทำถูกแล้ว) เพื่อคงคนที่เคยยกเว้นให้ยังไม่ต้องส่ง

### 2. Discord report channels เป็นคนละเรื่อง — ห้ามยุ่ง
`requiredWeekdays` ยังถูกใช้ในระบบ **Discord report** ซึ่งแยกจาก report-feed:
- `app/(shell)/admin/discord-reports/*`, `app/api/report-task/discord-ingest/route.ts`, `lib/discord/*`, `modules/admin/data/discord-report-actions.ts`
- พวกนี้มี `requiredWeekdays` ของตัวเอง (คนละ entity กับ `ReportTopic`) → **อย่าแก้** ในงานนี้ แก้เฉพาะ `ReportTopic.requiredWeekdays` เท่านั้น

### 3. `roundRunsOnDay` + `createdAt` — กันตัดสินย้อนหลัง
รอบที่มาจาก migration ต้อง **ไม่ใส่ `createdAt`** (ให้เดินพฤติกรรมเดิม ไม่กันย้อนหลัง) ส่วนรอบที่ผู้ใช้กด "เพิ่มรอบส่ง" ใหม่จริง ๆ ควรมี `createdAt` (มีอยู่แล้วในโค้ดเพิ่มรอบ) เพื่อไม่ให้ตัดสิน "พลาดส่ง" ย้อนไปก่อนวันสร้างรอบ

### 4. ห้องที่ไม่มี cutoffs และไม่มี rounds
= "ไม่มีใครต้องส่ง" (ไม่หัก/ไม่นับ) — migration ต้องไม่ไปสร้างรอบให้ห้องพวกนี้ (เช็ค `cutoffs.length > 0` ก่อนแปลง) พฤติกรรมนี้ต้องคงเดิม

### 5. โพสต์เก่าที่ไม่มี `roundId`
`attributePostToRound` เดารอบจากเวลาให้อยู่แล้ว — ไม่ต้องทำอะไรเพิ่ม แค่ยืนยันว่าหลัง migrate การจับโพสต์เข้ารอบยังถูก

---

## ไฟล์ที่เกี่ยวข้อง (อ้างอิงเร็ว)
- `modules/report_task/lib/submission-rounds.ts` — ตัวรวม (`effectiveRoundsOf` ฯลฯ); พิจารณาเพิ่ม util migrate กลางที่นี่
- `modules/report_task/store/report-feed-store.ts` — type `ReportTopic`/`ReportCutoff`/`SubmissionRound`; `normalizeReportFeedSlice` (จุด auto-migrate)
- `modules/report_task/components/report-feed/report-topic-settings-dialog.tsx` — ลบ UI รอบตัดยอด + รูปขั้นต่ำระดับห้อง + convertLegacy
- `modules/report_task/components/report-feed/room-settings-sheet.tsx` — ลบ UI วันที่ต้องส่งรายงาน + รูปขั้นต่ำระดับห้อง
- `modules/report_task/components/report-feed/submission-round-dialog.tsx` — ช่องรูปขั้นต่ำต่อรอบ (default 0), ตัด prop `roomDefaultMinImages`
- `modules/report_task/lib/report-cutoff.ts` — `minImagesNow` (แก้ให้ผ่าน effective rounds)
- `modules/report_task/lib/reminder-sweep.ts` — `lastCutoffMinutesOf(topic.cutoffs)`
- `modules/report_task/lib/report-feed-compliance.ts` — จุดอ่าน cutoffs/requiredWeekdays
- `app/(shell)/report-task/report-feed/page.tsx` — ส่วนหัวตาราง "เวลาส่ง"
- `modules/report_task/components/report-feed/report-topic-panels.tsx` — `hasSchedule`
- **อย่าแตะ:** `room-members-dialog.tsx` (exempt = visibility), ทุกไฟล์ใน `lib/discord/*` + `admin/discord-reports/*` + `discord-ingest`

## วิธีทดสอบ
- **ห้องเก่า (มี cutoffs+requiredWeekdays, ไม่มี submissionRounds):** โหลดแล้วต้องเห็นรอบส่งที่ migrate มา ตรงกับเวลา/วัน/คนยกเว้นเดิมเป๊ะ; การตัดสิน "ส่งช้า/ตรงเวลา/พลาดส่ง" และจำนวนรูปขั้นต่ำ เหมือนก่อน migrate
- **หน้าตั้งค่าห้อง:** ไม่เห็น "รอบตัดยอด", "วันที่ต้องส่งรายงาน", "จำนวนรูปขั้นต่ำ (ค่าเริ่มต้น)" อีก เห็นแต่ "เพิ่มรอบส่ง" ที่คุมครบ ใคร+เวลา+วัน+รูป
- **รูปขั้นต่ำต่อรอบ:** ตั้งรูปขั้นต่ำในกล่อง "เพิ่มรอบส่ง" ได้ (เช่น รอบเช้า 2 รูป, รอบเย็น 1 รูป) และตอนโพสต์ต้องบังคับตามรอบที่โพสต์เข้า
- **ห้องที่ไม่มีรอบส่ง:** โพสต์ได้โดยไม่ต้องแนบรูป (รูปขั้นต่ำ = 0) — ต้องไม่มีข้อความ "ต้องแนบอย่างน้อย N รูป" โผล่
- **ห้องเก่าที่เคยตั้งรูปขั้นต่ำระดับห้อง:** หลัง migrate รอบที่แปลงมาต้องยังบังคับรูปตามจำนวนเดิม
- **ห้องไม่มีตารางเลย:** ยัง = ไม่มีใครต้องส่ง (ไม่มีรอบถูกสร้าง)
- **แดชบอร์ด/สถิติ/แจ้งเตือน/ตัวกรอง "ส่งช้า":** ค่าตรงกับก่อนแก้ (เพราะทุกจุดอ่านผ่าน effective rounds แล้ว)
- **Discord report:** ไม่กระทบ (ทดสอบว่ายังตัดสินวันทำงานเหมือนเดิม)
- `pnpm typecheck` + `pnpm lint` ผ่าน; รัน unit test ที่มี (`report-feed-compliance` / `submission-rounds` ถ้ามี)

## Rollback
- แนะนำทำใน branch/PR เดียว และคง `effectiveRoundsOf` (สะพาน) ไว้ เพื่อให้ข้อมูล legacy ที่ยังไม่ถูกเขียนทับยังทำงานได้ — ถ้าต้องถอย แค่ revert PR ก็กลับสภาพเดิม (ยังไม่ลบ field legacy ในรอบนี้ ตามขั้น 4)
