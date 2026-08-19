# สเปกออกแบบ + คำสั่ง Claude Code: AI Insight v2 — วิเคราะห์ 3 ระดับ + ติดตามผลคำแนะนำ (Recommendation → Outcome)

> ไฟล์เดียวรวมทุกอย่าง: สถาปัตยกรรม + data model + prompt + การตัดสินใจ UI ล่าสุด (§13) + คำสั่งพร้อมวางให้ Claude Code ทีละเฟส (§14). แนะนำเซฟไว้ที่ `docs/ai-insight-v2-spec.md` ในโปรเจกต์

โมดูล: `apps/web/modules/report_task`
สถานะปัจจุบัน: AI Insight v1 (วิเคราะห์ระดับบริษัทก้อนเดียว, เทียบได้แค่ 2 รอบล่าสุด)
เป้าหมาย v2: วิเคราะห์แยก **รายคน / รายแผนก / ทั้งบริษัท**, เก็บ**เทรนด์ย้อนหลังเต็ม**, และ**ผูกคำแนะนำที่เคยให้เข้ากับผลลัพธ์จริง**ที่วัดค่าได้

---

## 1. เป้าหมายและขอบเขต

### สิ่งที่ต้องได้
1. **3 ระดับการวิเคราะห์** — ทุกระดับต้องบอก: เกิดอะไรขึ้น → เทรนด์เป็นยังไง → ควรทำอะไรต่อ
   - ระดับคน (รายบุคคล): ปัญหาเฉพาะคน + เทรนด์ของคนนั้น + คำแนะนำเจาะจง
   - ระดับแผนก: รวมข้อมูลตาม `departmentId`, เทียบแผนกกับแผนก, ชี้แผนกที่แนวโน้มแย่ลง
   - ระดับบริษัท: ภาพรวม (มีอยู่แล้วใน v1 — ยกมาต่อยอด)
2. **เทรนด์ย้อนหลังเต็ม** — ไม่ใช่แค่ "รอบนี้ vs รอบก่อน" แต่เก็บ log ทุกรอบ เพื่อดูทิศทางระยะยาว (ขึ้น/ลง/ทรงตัว) ของทุก subject
3. **ระบบผูกคำแนะนำ → ผลลัพธ์** — ทุกคำแนะนำที่ AI ให้ ต้อง:
   - ผูกกับ subject (คน/แผนก/บริษัท) + ตัวชี้วัด (metric) ที่วัดค่าได้
   - บันทึกค่าตั้งต้น (baseline) ณ ตอนให้คำแนะนำ
   - รอบถัดๆ ไป วัดค่าเดิมซ้ำ แล้วแสดงว่า "แนะนำแล้ว ดีขึ้น/แย่ลง/เท่าเดิม เท่าไหร่"

### สิ่งที่คงหลักการเดิมของ v1 (ห้ามพัง)
- **ต้นทุน token คงที่ไม่ว่าบริษัทใหญ่แค่ไหน** — ส่งเข้า LLM เฉพาะสรุปที่ capped แล้ว (ดู `MAX_PEOPLE_PER_GROUP`, `MAX_PEOPLE_OVERALL`)
- **การคำนวณตัวเลขทำฝั่งเซิร์ฟเวอร์แบบ deterministic** ไม่ให้ LLM เดา (เช่น `projectedSuccessRate`, `combinedSuccessRate` คำนวณเองใน `aggregate.ts`)
- **state ที่กันการปลอมแปลง** — `ai-insight-result` เป็น server-only key ไม่อยู่ใน `STORE_KEYS` whitelist ของ store route (client PUT ไม่ได้) — ของใหม่ทุก key ที่เกี่ยวกับผล/quota/ledger ต้องเป็น server-only เหมือนกัน
- **quota/plan gating** — FREE=0, PRO=50/เดือน (ดู `AI_INSIGHT_MONTHLY_LIMIT`)

### นอกขอบเขต (เฟสนี้)
- ไม่แตะการคำนวณ KPI ที่โชว์บนแดชบอร์ดหลัก (`kpi-buckets.ts`, ฝั่ง client) — v2 อ่านข้อมูลเดียวกันแต่ไม่เขียนทับ
- ไม่ทำ per-date-exemption (ลา/วันหยุด) ในฝั่ง server aggregate — คงข้อจำกัดเดิมของ `mustReportToTopicServer` ไว้ก่อน

---

## 2. สถาปัตยกรรมปัจจุบัน (v1) — จุดอ้างอิง

```
buildAiInsightAggregate(orgId)        // aggregate.ts — อ่าน 100% ของ task+report, ลดรูปเป็นสรุป capped
   → callOpenAiInsight(aggregate)     // openai-client.ts — gpt-4o-mini, ตอบ JSON: insightText/stats/actions/personNotes
      → runAiInsightAnalysis()        // analyze.ts — save state, นับ quota, snapshot `previous`
         → เก็บที่ store key "ai-insight-result" (server-only)
            → AiInsightCard            // ai-insight-card.tsx — เรนเดอร์ + แสดง delta vs previous
```

โครงข้อมูลปัจจุบัน (`lib/ai-insight/types.ts`):
- `AiInsightState.previous` = snapshot รอบก่อน **รอบเดียว**: `{ combinedSuccessRate, personTotals }`
- ไม่มีมิติแผนก, ไม่มีประวัติหลายรอบ, ไม่มีการผูกคำแนะนำกับผลลัพธ์ (actions เป็น free-text ที่วัดผลย้อนกลับไม่ได้)

---

## 3. ช่องว่างที่ต้องอุด (Gap Analysis)

| ความต้องการ v2 | v1 มีอะไร | ต้องเพิ่มอะไร |
|---|---|---|
| ระดับคน | มี `people[]` + `personNotes[]` | เพิ่ม**เทรนด์รายคน** (จาก history) |
| ระดับแผนก | **ไม่มีเลย** | aggregate ใหม่ตาม `departmentId` + dept success rate + dept notes |
| ระดับบริษัท | มี `combinedSuccessRate` + `insightText` | เพิ่มเทรนด์ระยะยาว |
| เทรนด์ย้อนหลัง | เทียบได้ 2 รอบ (`previous`) | **history log แบบ append-only** |
| คำแนะนำ→ผลลัพธ์ | actions เป็นข้อความลอย วัดผลไม่ได้ | **structured action + ledger + reconciliation** |

---

## 4. ระดับแผนก (Department-level) — ออกแบบ

### 4.1 แหล่งข้อมูล
`listDirectory(orgId)` คืน `DirectoryUser` ที่มี `departmentId` อยู่แล้ว และ `lib/db/departments.ts` มี `findMany({ where: { orgId }, orderBy: { name } })` สำหรับชื่อแผนก → ทำ map `departmentId → departmentName` ได้ทันที ไม่ต้อง query เพิ่มนอกจากดึงชื่อแผนก

### 4.2 โครงข้อมูลใหม่ (`lib/ai-insight/types.ts`)

```ts
/** สรุปหนึ่งแผนก — คำนวณ deterministic ฝั่ง server ไม่ใช่ AI เขียน */
export interface AiInsightDeptBreakdown {
  departmentId: string;
  name: string;
  headcount: number;
  /** success rate รวม (task+report) ของเฉพาะคนในแผนกนี้ */
  successRate: number;
  /** ยอดรายการที่ยัง "เปิดค้าง" ของแผนก (overdue+pending+missed) รวมทุกคน */
  openTotal: number;
  /** บั๊กเก็ตปัญหาเด่นของแผนก เรียงมากไปน้อย (label เดียวกับ flagged) */
  topIssues: { label: string; domain: "task" | "report"; count: number }[];
}
```

### 4.3 การคำนวณ (ต่อยอดใน `aggregate.ts`)
เพิ่มฟังก์ชัน `departmentBreakdownOf(...)` ที่:
1. group `DirectoryUser` ตาม `departmentId` (คนที่ `departmentId === ""` → รวมเป็นกลุ่ม "ไม่ระบุแผนก")
2. สำหรับแต่ละแผนก รวม task buckets ของสมาชิก (จาก `taskBucketsByAssignee`) + report counts (จาก `reportByUser`) → คำนวณ `successRate` ด้วยสูตรเดียวกับ `finalizeReport`/combined ที่มีอยู่
3. `topIssues` = บั๊กเก็ตของแผนกที่ count > 0 เรียงมากไปน้อย, cap ไว้ 3 รายการต่อแผนก
4. **cap จำนวนแผนกที่ส่งเข้า prompt** ด้วยค่าคงที่ใหม่ `MAX_DEPTS = 6` (worst-first ตาม openTotal) — คงหลัก "token คงที่" เดิม

เพิ่มฟิลด์ลง `AiInsightAggregate`:
```ts
departments: AiInsightDeptBreakdown[];   // เรียง worst-first, capped ที่ MAX_DEPTS
```

### 4.4 ผลลัพธ์จาก LLM (ระดับแผนก)
เพิ่มใน `AiInsightResult`:
```ts
export interface AiInsightDeptNote {
  name: string;          // ต้องตรงกับชื่อแผนกใน departments[] เป๊ะ
  trendHint?: "up" | "down" | "flat";  // เติมจาก history ฝั่ง server (ไม่ใช่ AI เดา)
  note: string;          // 1 ประโยค: แผนกนี้ควรโฟกัสอะไรก่อน + เพราะอะไร
}
// เพิ่ม: deptNotes: AiInsightDeptNote[]
```

---

## 5. เทรนด์ย้อนหลังเต็ม (History) — ออกแบบ

### 5.1 หลักการ
เลิกใช้ `previous` (snapshot รอบเดียว) เป็นแหล่งความจริง → เก็บ **log แบบ append-only** แยก store key ใหม่ แล้ว `previous` กลายเป็นแค่ "รายการล่าสุดใน history" (คงไว้เพื่อ backward-compat ของการ์ด)

### 5.2 Store key ใหม่ (server-only)
`ai-insight-history` — **ห้ามใส่ใน `STORE_KEYS` whitelist** (เหตุผลเดียวกับ `ai-insight-result`: กันไคลเอนต์ปลอมประวัติ/รีเซ็ต) อ่าน/เขียนผ่าน `readStore`/`writeStore` โดย `analyze.ts` เท่านั้น

### 5.3 โครงข้อมูล
```ts
export interface AiInsightSnapshot {
  at: string;                       // ISO ของรอบที่ generate
  combinedSuccessRate: number;
  deptRates: Record<string, number>;   // departmentId → successRate
  personTotals: Record<string, number>; // ชื่อคน → openTotal
  flaggedCounts: Record<string, number>; // "domain:key" → count (เช่น "report:missed" → 28)
}

export interface AiInsightHistory {
  snapshots: AiInsightSnapshot[];   // เรียงเก่า→ใหม่
}
```

### 5.4 Retention (กันไฟล์บวม)
- เก็บสูงสุด `MAX_SNAPSHOTS = 24` รอบล่าสุด (PRO ใช้ได้ 50/เดือน → ~2 เดือนของประวัติละเอียด ก็เพียงพอต่อการดูเทรนด์) เกินนั้นตัดหัวทิ้ง (FIFO)
- ขนาดต่อ snapshot เล็ก (แค่ตัวเลข ไม่มีข้อความ AI) → 24 รอบยังเบามาก

### 5.5 การคำนวณเทรนด์ (deterministic, ฝั่ง server)
ฟังก์ชัน `computeTrend(history, subjectKey)` คืน `"up" | "down" | "flat"`:
- ใช้ค่าจาก N snapshot ล่าสุด (เช่น 3 รอบ) เทียบความชัน — ถ้าเปลี่ยน ≤ 2% ถือเป็น `flat`
- ทิศทาง "ดี" ต่างกันตาม metric: success rate → สูงขึ้น = up = ดี; openTotal/บั๊กเก็ตปัญหา → ต่ำลง = ดี
- ค่านี้ถูกเติมลง `trendHint` ของ dept/person notes **ก่อน**ส่งให้การ์ดเรนเดอร์ (LLM ไม่ต้องเดาเทรนด์ แค่เขียนคำแนะนำ)

> เหตุผลที่เทรนด์คำนวณ server ไม่ให้ LLM ทำ: หลักการเดียวกับ `projectedSuccessRate` เดิม — ตัวเลขต้องเชื่อถือได้และตรงกันทุกครั้ง

---

## 6. ผูกคำแนะนำ → ผลลัพธ์ (Recommendation Ledger) — หัวใจของ v2

นี่คือส่วนที่ยากและใหม่ที่สุด: ทำให้คำแนะนำที่ AI ให้ **วัดผลย้อนกลับได้**

### 6.1 ปัญหาของ v1
`actions[].detail` เป็นข้อความอิสระ เช่น "ให้ Katawut จัดการรายงานขาดส่ง 7 รายการ" — วัดผลไม่ได้เพราะไม่รู้ว่าจะไปวัด metric ไหน ของ subject ไหน เทียบกับค่าอะไร

### 6.2 แนวคิดแก้: ทุกคำแนะนำต้อง "จับต้องเป็นตัวเลขได้"
บังคับให้ทั้ง `actions` และ `personNotes`/`deptNotes` **แนบ target ที่วัดได้** โดย LLM เลือกจาก enum ปิด (ไม่ให้แต่งเอง) ส่วนค่าตัวเลข server เป็นคนใส่จาก aggregate จริง

#### Metric enum (ปิด — วัดจาก aggregate ได้ทั้งหมด)
```ts
export type InsightMetricKey =
  | "overdue_tasks" | "pending_tasks" | "late_tasks"
  | "missed_reports" | "pending_reports" | "late_reports"
  | "open_total"              // ผลรวมค้างทั้งหมดของ subject
  | "success_rate";           // ใช้ได้กับ dept/company

/** ทิศทางที่ถือว่า "ดีขึ้น" ต่อ metric */
const METRIC_BETTER_WHEN: Record<InsightMetricKey, "lower" | "higher"> = {
  overdue_tasks: "lower", pending_tasks: "lower", late_tasks: "lower",
  missed_reports: "lower", pending_reports: "lower", late_reports: "lower",
  open_total: "lower", success_rate: "higher",
};
```

### 6.3 โครงข้อมูล Ledger (store key ใหม่ server-only: `ai-insight-ledger`)
```ts
export type RecoSubjectType = "person" | "department" | "company";
export type RecoStatus = "open" | "improved" | "resolved" | "regressed";

export interface RecommendationRecord {
  id: string;                    // hash(subjectType + subjectKey + metricKey) — คงที่ เพื่อ dedupe ข้ามรอบ
  subjectType: RecoSubjectType;
  subjectKey: string;            // person=ชื่อ, department=departmentId, company="__company__"
  subjectName: string;           // ไว้โชว์
  metricKey: InsightMetricKey;
  detail: string;                // ข้อความคำแนะนำจาก AI (สำหรับอ่าน)
  severity: "high" | "mid" | "good";
  issuedAt: string;              // ISO รอบที่ให้คำแนะนำครั้งแรก
  baseline: number;              // ค่า metric ณ issuedAt
  latestValue: number;          // ค่า metric ล่าสุดที่วัดซ้ำ
  checkedAt: string;             // ISO รอบล่าสุดที่วัดซ้ำ
  status: RecoStatus;
  /** ประวัติค่าของ metric นี้ทุกครั้งที่วัด — ไว้วาดกราฟ before/after */
  trail: { at: string; value: number }[];
}

export interface AiInsightLedger {
  records: RecommendationRecord[];
}
```

### 6.4 อัลกอริทึม Reconciliation (รันทุกรอบใน `analyze.ts` หลังได้ aggregate ใหม่)

```
สำหรับแต่ละ action/note ที่ LLM ให้คำแนะนำในรอบนี้:
  key = id(subjectType, subjectKey, metricKey)
  currentValue = ดึงค่า metric ของ subject นั้นจาก aggregate รอบนี้ (deterministic)
  ถ้า ledger ยังไม่มี key นี้:
     → สร้าง record ใหม่: baseline = latestValue = currentValue, status = "open",
       trail = [{at: now, value: currentValue}]
  ถ้ามีอยู่แล้ว (เคยแนะนำเรื่องนี้ไปแล้ว):
     → ไม่ทับ baseline (คงค่า ณ ครั้งแรกที่แนะนำ), อัปเดต latestValue = currentValue,
       push trail, อัปเดต detail เป็นข้อความล่าสุด

สำหรับทุก record ที่ "open/improved/regressed" อยู่ (แม้รอบนี้ AI ไม่ได้พูดถึง):
  → วัดค่า metric ซ้ำจาก aggregate รอบนี้เสมอ, push trail, จัด status ใหม่:
     better = (METRIC_BETTER_WHEN[metric]=="lower")
              ? latestValue < baseline : latestValue > baseline
     ถึงเป้า (สำหรับ metric แบบ count ที่ better=lower และ latestValue==0) → "resolved"
     ดีขึ้นแต่ยังไม่ถึง 0 → "improved"
     แย่กว่า baseline → "regressed"
     เท่าเดิม → คง "open"

retention: เก็บ record ที่ resolved ไว้ MAX_RESOLVED_KEEP=20 รายการล่าสุด (ไว้โชว์ผลงาน "แก้สำเร็จแล้ว"),
           ตัด record ที่ resolved เก่ากว่านั้นทิ้ง; open/regressed เก็บทั้งหมด
```

### 6.5 ค่าที่แสดงผล (before/after)
สำหรับแต่ละ record การ์ดแสดง:
- ข้อความคำแนะนำ + subject + วันที่ให้คำแนะนำ
- `baseline → latestValue` พร้อม delta และ % เปลี่ยนแปลง (เช่น "รายงานขาดส่ง 28 → 12 รายการ, ลดลง 16 (−57%) ใน 3 รอบ")
- ป้ายสถานะ: ✅ แก้สำเร็จ / 📈 ดีขึ้น / ➡️ เท่าเดิม / ⚠️ แย่ลง
- sparkline เล็กจาก `trail` (ใช้ component กราฟที่มีอยู่แล้วในโมดูล)

> จุดสำคัญเชิงประสบการณ์: นี่คือสิ่งที่ทำให้ผู้ใช้เห็น "AI แนะนำแล้วได้ผลจริงไหม" — เปลี่ยนจาก "AI บอกให้ทำ" เป็น "AI พิสูจน์ว่าทำแล้วดีขึ้นเท่านี้"

---

## 7. การเปลี่ยน Prompt (`openai-client.ts`)

### 7.1 ข้อมูลเข้า (buildPrompt) เพิ่ม
- บล็อก **รายแผนก**: ชื่อแผนก, headcount, success rate, top issues, + `trendHint` ที่ server คำนวณไว้ ("แผนก IT: 45% (แย่ลง 3 รอบติด), ปัญหาหลัก: รายงานขาดส่ง 12")
- บล็อก **คำแนะนำเดิมที่ยัง open**: "รอบก่อนเคยแนะนำ X กับ Y (baseline Z) — ตอนนี้ค่าเป็น W" เพื่อให้ AI เขียน insight แบบรู้บริบทว่าอะไรดีขึ้น/ยังค้าง
- บล็อก **เทรนด์บริษัท**: success rate 3 รอบล่าสุด

### 7.2 ข้อมูลออก (JSON schema) เพิ่ม/เปลี่ยน
```jsonc
{
  "insightText": "...",           // คงกฎเดิม + ให้อ้างเทรนด์/ผลของคำแนะนำเดิมได้ถ้ามี
  "stats": [ ...4 ตัวเหมือนเดิม ],
  "actions": [                     // เปลี่ยนเป็น structured — บังคับแนบ target
    { "subjectType": "person|department|company",
      "subjectName": "ตรงกับรายชื่อ/แผนกที่ให้มาเป๊ะ",
      "metricKey": "<enum ปิด>",
      "detail": "คำแนะนำเจาะจง บอกผลลัพธ์ที่จะได้",
      "severity": "high|mid|good" }
  ],
  "personNotes": [ { "name": "...", "metricKey": "...", "priority": "..." } ],
  "deptNotes":   [ { "name": "...", "note": "..." } ]   // ใหม่
}
```

### 7.3 กฎใหม่ใน SYSTEM_PROMPT
- ต่อจากกฎ v1 ทั้งหมด (ห้ามท่องตัวเลขซ้ำ, ประโยค "ถ้าแก้อันดับ 1...", personNotes ห้ามซ้ำ) เพิ่ม:
  - `subjectName` และ `metricKey` **ต้องเลือกจากรายการที่ให้มาเท่านั้น ห้ามแต่ง** (server จะ reject record ที่ subject/metric ไม่ match แล้วข้ามไป — ไม่พังทั้งรอบ)
  - ถ้ามีบล็อก "คำแนะนำเดิมที่ยัง open" ให้ insightText กล่าวถึงความคืบหน้าอย่างน้อย 1 จุด ("รายงานขาดส่งลดจาก 28 เหลือ 12 หลังโฟกัสทีม Katawut")
  - deptNotes เขียนเฉพาะแผนกใน list, ห้ามเกิน 1 ประโยค/แผนก, ห้ามซ้ำประโยคข้ามแผนก (กฎเดียวกับ personNotes)

### 7.4 ต้นทุน token
- prompt โตขึ้นตาม (แผนก capped 6 + คำแนะนำ open capped ~10) — ยังเป็น **ค่าคงที่ต่อรอบ ไม่ผันตามขนาดบริษัท** ตามหลักเดิม
- ประเมินคร่าว: input tokens เพิ่ม ~40–60% ต่อรอบ, ยังอยู่ในระดับเศษสตางค์ที่ gpt-4o-mini (input $0.15/1M) — ควร**วัดจริง**ด้วยตัวนับ `usage` ที่มีอยู่แล้วหลัง implement

---

## 8. UI/UX (`ai-insight-card.tsx` + คอมโพเนนต์ใหม่)

### 8.1 โครงการ์ด (เพิ่ม tab 3 ระดับ)
คงหัวการ์ด + insightText + 4 stats + ปุ่ม "วิเคราะห์ตอนนี้/ออโต้" เดิมไว้ด้านบน แล้วเพิ่มแถบแท็บด้านล่าง:

```
[ ภาพรวมบริษัท ]  [ รายแผนก ]  [ รายคน ]  [ ผลของคำแนะนำ ]
```

- **ภาพรวมบริษัท**: insightText + stats + เทรนด์ success rate (กราฟเส้นจาก history) + delta vs รอบก่อน (ยกของเดิมมา)
- **รายแผนก** (ใหม่): การ์ดต่อแผนก — success rate, ป้ายเทรนด์ (↑/↓/→), top issues, deptNote
- **รายคน**: personNotes + breakdown (ยกของเดิม) + เพิ่มป้ายเทรนด์รายคนจาก history + delta openTotal
- **ผลของคำแนะนำ** (ใหม่ — พระเอกของ v2): รายการ RecommendationRecord แยก 2 กลุ่ม
  - "กำลังติดตาม" (open/improved/regressed) พร้อม before→after + sparkline + ป้ายสถานะ
  - "แก้สำเร็จแล้ว" (resolved) โชว์เป็นผลงาน

### 8.2 ป้ายสถานะ (ใช้ไอคอนจาก lucide ที่ import อยู่แล้ว: TrendingUp, ArrowUp, ArrowDown)
| สถานะ | สี | ความหมาย |
|---|---|---|
| resolved | เขียว | ค่าลงถึง 0 / ถึงเป้า |
| improved | เขียวอ่อน | ดีขึ้นแต่ยังไม่ถึงเป้า |
| open | เทา | เพิ่งแนะนำ/ยังไม่ขยับ |
| regressed | แดง | แย่กว่าตอนแนะนำ |

### 8.3 ข้อมูลที่การ์ดรับเพิ่ม
ขยาย response ของ `GET /api/report-task/ai-insight` (status) ให้รวม `departments`, `history` (ย่อ), `ledger` — ทั้งหมดอ่านจาก state ที่ cache ไว้ ไม่เรียก OpenAI ตอนโหลดการ์ด (คงพฤติกรรม `getAiInsightStatus` เดิม)

---

## 9. การเปลี่ยนฝั่ง API / Server

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `lib/ai-insight/types.ts` | เพิ่ม `AiInsightDeptBreakdown`, `AiInsightDeptNote`, `AiInsightSnapshot`, `AiInsightHistory`, `RecommendationRecord`, `AiInsightLedger`, `InsightMetricKey`; ขยาย `AiInsightResult`/`AiInsightState`/`AiInsightAggregate` |
| `lib/ai-insight/aggregate.ts` | เพิ่ม `departmentBreakdownOf()` + ฟังก์ชันดึงค่า metric ต่อ subject (`metricValueOf(agg, subjectType, subjectKey, metricKey)`) ใช้ร่วมกับ reconciliation |
| `lib/ai-insight/openai-client.ts` | prompt ใหม่ (ดู §7), parse `deptNotes` + structured actions, reject subject/metric ที่ไม่ match |
| `lib/ai-insight/history.ts` (ใหม่) | `appendSnapshot()`, `computeTrend()`, retention |
| `lib/ai-insight/ledger.ts` (ใหม่) | `reconcile(ledger, agg, aiActions, now)` → ledger ใหม่ + record ที่ status เปลี่ยน |
| `lib/ai-insight/analyze.ts` | หลัง `callOpenAiInsight`: เรียก history append + ledger reconcile ก่อน `writeStore`; อ่าน 3 store keys (result/history/ledger) ตอน status |
| `app/api/report-task/ai-insight/route.ts` | คืน `departments`/`history`/`ledger` ใน status response |

> **Backward-compat**: `previous` ยังคงอยู่ (= snapshot ล่าสุดจาก history) เพื่อไม่ต้องแก้โค้ดการ์ดส่วน delta เดิมทันที; state เก่าที่ไม่มี field ใหม่ให้ fallback `?? []`/`?? null` แบบเดียวกับที่ `getAiInsightStatus` ทำอยู่แล้ว

---

## 10. Edge cases ที่ต้องกัน

1. **คนเปลี่ยนชื่อ / ลาออก** — ledger keyed ด้วยชื่อ (person) อาจเพี้ยนถ้าเปลี่ยนชื่อ → พิจารณา key ด้วย userId แทนชื่อในเฟสถัดไป (เฟสนี้ยอมรับ limitation, บันทึกไว้)
2. **แผนกถูกลบ/ยุบ** — `departmentId` หายจาก directory → record ระดับแผนกที่ค้างให้ mark เป็น "แผนกถูกยุบ" ไม่เอามาคำนวณ delta ต่อ
3. **total = 0** (บริษัทเพิ่งเริ่ม ไม่มีงาน) — คง guard `combinedTotal ? ... : 0` เดิม, ทุก rate = 0, ledger ว่าง
4. **LLM ส่ง subjectName/metric ที่ไม่มีจริง** — reconciliation ข้าม record นั้น (ไม่ throw ทั้งรอบ) และ log ไว้
5. **metric แบบ success_rate กับ subject person** — ไม่รองรับ (person ใช้ count metrics เท่านั้น) → validation ปฏิเสธคู่ที่ไม่สมเหตุผล
6. **รอบแรกสุด** — history/ledger ว่าง, แท็บ "ผลของคำแนะนำ" แสดง empty state "ยังไม่มีคำแนะนำที่ติดตามผล — วิเคราะห์อีก 1-2 รอบเพื่อเริ่มเห็นผลลัพธ์"
7. **quota หมดกลางเดือน** — คง gating เดิม; history/ledger ไม่ถูกแก้ถ้าไม่ได้ run รอบใหม่

---

## 11. แผนทำเป็นเฟส (แนะนำลำดับ implement)

**เฟส A — ระดับแผนก (เห็นผลเร็ว, เสี่ยงต่ำ)**
เพิ่ม `departmentBreakdownOf` + `departments` ใน aggregate → prompt รับ dept block + `deptNotes` → แท็บ "รายแผนก" ในการ์ด ทดสอบว่าตัวเลข dept ตรงกับที่รวมมือได้

**เฟส B — History + เทรนด์**
`history.ts` + store key `ai-insight-history` → `computeTrend` → ป้ายเทรนด์ในแท็บแผนก/คน + กราฟ success rate บริษัท

**เฟส C — Ledger (before/after) — พระเอก**
`ledger.ts` + structured actions ใน prompt + reconciliation ใน analyze → แท็บ "ผลของคำแนะนำ" นี่คือส่วนที่ควรทำหลังสุดเพราะพึ่ง history + dept ที่ทำไว้แล้ว

แต่ละเฟส deploy แยกได้ (แต่ละอันไม่ทำให้ v1 พัง เพราะ field ใหม่มี fallback หมด)

---

## 12. เกณฑ์ตรวจรับ (Acceptance)

- [ ] แท็บ "รายแผนก" แสดง success rate ที่**รวมมือแล้วตรงกัน**กับผลรวมสมาชิกในแผนก
- [ ] ป้ายเทรนด์ (↑/↓/→) มาจาก history ≥3 รอบ ไม่ใช่ AI เดา
- [ ] คำแนะนำทุกข้อในแท็บ "ผลของคำแนะนำ" มี `baseline → latest` เป็นตัวเลขจริงจาก aggregate
- [ ] เมื่อ metric ของ subject ลงถึง 0 → record เปลี่ยนเป็น "แก้สำเร็จ" อัตโนมัติในรอบถัดไป
- [ ] ต้นทุน token ต่อรอบไม่ผันตามจำนวนพนักงาน (ทดสอบด้วย org เล็ก vs org ใหญ่จำลอง)
- [ ] state v1 เก่า (ไม่มี field ใหม่) โหลดการ์ดได้ ไม่ crash
- [ ] `ai-insight-history` และ `ai-insight-ledger` **PUT จาก client route ไม่ได้** (ไม่อยู่ใน `STORE_KEYS`)

---

## ภาคผนวก: ตัวอย่างเชิงเล่าเรื่อง (จากหน้าจอที่ให้มา)

รอบที่ 1 (19 ส.ค.): success rate 10%, ปัญหาอันดับ 1 = รายงานขาดส่ง 28 รายการ (Katawut, Pacharapol-IT, Sujita-A, Waratta-Nok คนละ 7)
→ AI ออก action: `{subjectType:"company", metricKey:"missed_reports", detail:"เร่งเคลียร์รายงานขาดส่ง 28 รายการสัปดาห์นี้"}`
→ ledger สร้าง record: baseline=28, status=open

รอบที่ 3 (2 สัปดาห์ถัดมา): วัดซ้ำ missed_reports = 12
→ record: baseline 28 → latest 12, status="improved", trail=[28,19,12]
→ การ์ดแท็บ "ผลของคำแนะนำ" แสดง: **"รายงานขาดส่ง 28 → 12 (−57%) หลังโฟกัสทีม Katawut · 📈 ดีขึ้น"**
→ insightText รอบนี้: "รายงานขาดส่งลดลงมากกว่าครึ่งจากรอบก่อน เหลือจุดค้างหลักที่ Pacharapol-IT..."

นี่คือ loop "แนะนำ → วัด → พิสูจน์ผล" ที่ v1 ยังทำไม่ได้
```

---

## 13. การตัดสินใจด้าน UI ล่าสุด (มีผลเหนือ §8 เมื่อขัดกัน)

หลังทำ mockup กับผู้ใช้ ได้ข้อสรุปการแสดงผลดังนี้ — **ให้ยึดอันนี้เป็นหลัก**

### 13.1 ไม่ใช้กราฟ — ใช้ตัวเลข % เทียบช่วงแทน
ทุกจุดที่เดิมคิดจะเป็นกราฟเส้น/sparkline **ตัดออกทั้งหมด** แล้วแสดงเป็นข้อความสั้นแทน เพื่อประหยัดพื้นที่และอ่านเร็ว:
- **ภาพรวมบริษัท**: แถวเดียว — `<rate>% สำเร็จรวม [ป้ายสถานะ] ↑ดีขึ้น X% / ↓แย่ลง X% / →เท่าเดิม จากช่วงก่อนหน้า`
- **รายแผนก / รายคน**: ป้ายเทรนด์เป็นข้อความ `↑ ดีขึ้น X%` (เขียว) / `↓ แย่ลง X%` (แดง) / `→ เท่าเดิม` (เทา) — ค่า X มาจาก `computeTrend().pctChange` (server คำนวณ)
- **ผลของคำแนะนำ**: แสดง `baseline → latest หน่วย · ±delta (±%)` ไม่มี sparkline

### 13.2 เกณฑ์ป้ายสถานะ (success rate)
กำหนดตายตัวใน server/utility เดียว ใช้ร่วมทุกที่:

| ช่วง success rate | ป้าย | สี (traffic-light) |
|---|---|---|
| < 30% | วิกฤต | แดง (`--chart-red`) |
| 30–70% | ต้องเร่ง / เฝ้าระวัง | เหลือง (`--chart-amber`) |
| > 70% | ดี | เขียว (`--chart-green`) |

ป้ายสถานะทุกอันมี **ไอคอน + ข้อความ** เสมอ ไม่ใช้สีอย่างเดียว (รองรับ CVD)

### 13.3 KPI cards (4 การ์ดแบบใบการ์ด) — สไตล์ตามที่ผู้ใช้เลือกล่าสุด (ล่าสุด)
เปลี่ยนจากกล่องใหญ่ 2×2 (สูง ~120px โล่ง) เป็น **แถวเดียว 4 การ์ดกะทัดรัด**:
- container โค้งมนใบเดียว, ข้างในเป็น grid 4 คอลัมน์ (จอ <640px ยุบเป็น 2×2)
- แต่ละการ์ด: ตัวเลขใหญ่ชิดซ้ายบน (สีตามสถานะ) + ไอคอนในวงกลมพื้นสีอ่อนมุมขวาบน + label ใต้ตัวเลข + ปุ่ม **"ดูรายละเอียด"** outlined เต็มกว้างท้ายการ์ด (คลิกไปหน้า/โมดัลรายละเอียดของ metric นั้น)
- responsive: จอแคบ (<640px) ยุบเป็น 2×2
- reference mockup: `kpi-final.html`

**Label (2026-08-19, revert ตามฟีดแบ็กจริงหลัง deploy):** เคยลองแยกคำให้ชัดขึ้นเป็น "ยังไม่เสร็จ · ในกำหนด" / "ยังไม่เสร็จ · เลยกำหนด" (กันความกำกวม pending vs overdue) แต่ผู้ใช้เห็นของจริงบนการ์ดแล้วอยากได้คำสั้นแบบเดิมกลับคืน — **label ปัจจุบันคือ**:
- `pending` (task) → **"งานยังไม่เสร็จ"** (โทน amber)
- `overdue` (task) → **"งานเลยกำหนด"** (โทน red)
- อีก 2 การ์ด: **"คนควรคุยด่วน"** (แดง), **"รายงานยังไม่ส่ง"** (ฟ้า)
- บทเรียน: ก่อนเปลี่ยน label ให้ "ชัดเจนขึ้นตามทฤษฎี" ควรเช็คกับผู้ใช้ก่อนด้วยรูปเทียบ ไม่ใช่แค่ทำตามสเปกแล้ว deploy เลย

ทุกสียังคงใช้ CSS variable จาก `theme.css` เท่านั้น (`--chart-red/-amber/-green/-blue` + `-dark` สำหรับ text/border บนพื้นอ่อน) ห้าม hardcode hex — และห้ามแก้ค่าตัวเลข/การคำนวณที่มาจากฝั่ง server (นี่เป็นแค่การเปลี่ยนการนำเสนอ)

### 13.4 แท็บ 4 อัน
`[ ภาพรวมบริษัท ] [ รายแผนก (n) ] [ รายคน (n) ] [ ผลของคำแนะนำ (n) ]` — ตัวเลขในวงเล็บคือจำนวนรายการ

### 13.5 รายการยาว = ย่อ/ขยาย (สำคัญ)
ทุกลิสต์ (รายคน, รายแผนก, กลุ่ม "กำลังติดตามผล" ในแท็บคำแนะนำ) **แสดงแค่ 3 แถวแรก** ที่เหลือซ่อนไว้ใต้ปุ่ม `ดูเพิ่มอีก N รายการ ▾` กดแล้วขยาย, กดอีกครั้งเป็น `ย่อ ▴`. ถ้ามี ≤ 3 แถวไม่ต้องมีปุ่ม
- implement เป็น component เดียว reuse ได้ (เช่น `<CollapsibleList show={3}>`), default `show=3`
- record ที่ resolved ("แก้สำเร็จแล้ว") แยกกลุ่มของตัวเอง และ collapse ต่างหาก

### 13.6 สี
ใช้ CSS variable จาก `modules/report_task/theme.css` เท่านั้น — `--chart-violet #4a3aa7` (accent การ์ด/แท็บ active), `--chart-blue`, traffic-light `--chart-green/-amber/-red` (+ `-dark` สำหรับ text บนพื้นอ่อน). ห้าม hardcode hex ใหม่

---

## 14. คำสั่งสำหรับ Claude Code (พร้อมวาง สั่งทีละเฟส)

> ก่อนเริ่ม: เซฟไฟล์นี้ไว้ที่ `docs/ai-insight-v2-spec.md` ในโปรเจกต์ แล้วอ้างอิงได้ในทุกคำสั่ง

### เฟส A — ระดับแผนก

```
อ่านโมดูล AI Insight เดิมทั้งหมดก่อน: apps/web/modules/report_task/lib/ai-insight/{types,aggregate,analyze,openai-client}.ts, components/dashboard/ai-insight-card.tsx, lib/db/{employee-directory,departments,org-store,store-registry}.ts, lib/plan.ts และ docs/ai-insight-v2-spec.md

ทำตาม §4 + §13 ของสเปก: เพิ่มการวิเคราะห์ระดับแผนก โดยห้ามพัง v1
1) types.ts: เพิ่ม AiInsightDeptBreakdown, AiInsightDeptNote; เพิ่ม departments[] ใน AiInsightAggregate; เพิ่ม deptNotes[] ใน AiInsightResult และ AiInsightState (fallback ?? [] ตอนอ่าน state เก่า)
2) aggregate.ts: เพิ่ม departmentBreakdownOf() — group ตาม departmentId (ว่าง=“ไม่ระบุแผนก”), ชื่อจาก departments.ts, รวม task+report ต่อสมาชิก, successRate สูตรเดียวกับ combinedSuccessRate, topIssues cap 3/แผนก, เรียง worst-first, cap MAX_DEPTS=6
3) openai-client.ts: เพิ่มบล็อกแผนกใน buildPrompt + กฎ deptNotes ใน SYSTEM_PROMPT (1 ประโยค/แผนก ห้ามซ้ำข้ามแผนก subjectName ตรงกับที่ให้มา) + parse deptNotes (fallback [])
4) analyze.ts: เก็บ departments + deptNotes ลง nextState
5) ai-insight-card.tsx: เพิ่มแท็บ [ภาพรวมบริษัท | รายแผนก | รายคน]; แท็บแผนกแสดง successRate + ป้ายสถานะตามเกณฑ์ §13.2 + topIssues + deptNote; ใช้สีจาก theme.css เท่านั้น
ห้ามแก้ kpi-buckets.ts / การคำนวณ client. typecheck + build ต้องผ่าน
```

### เฟส B — ประวัติ + เทรนด์ (แสดงเป็น %)

```
ต่อจากเฟส A. ทำตาม §5 + §13.1/§13.2 ของสเปก
1) store key ใหม่ "ai-insight-history" — ห้ามใส่ STORE_KEYS whitelist (server-only) อ่าน/เขียนผ่าน analyze.ts เท่านั้น
2) lib/ai-insight/history.ts: AiInsightSnapshot {at, combinedSuccessRate, deptRates, personTotals, flaggedCounts}, AiInsightHistory {snapshots[]} (เก่า→ใหม่); appendSnapshot() เก็บสูงสุด MAX_SNAPSHOTS=24 (FIFO); computeTrend(history,key) คืน {dir:"up"|"down"|"flat", pctChange} เทียบรอบล่าสุดกับก่อนหน้า เปลี่ยน<=2%=flat ทิศทางดีต่างตาม metric; util statusOf(rate) คืน วิกฤต/เฝ้าระวัง/ดี ตามเกณฑ์ §13.2
3) analyze.ts: เรียก appendSnapshot หลังได้ aggregate; เติม trendHint(+pctChange) ให้ deptNotes/personNotes จาก computeTrend
4) ai-insight-card.tsx: แสดงเทรนด์เป็นข้อความ % ไม่ใช่กราฟ — ภาพรวม “<rate>% สำเร็จรวม [statusChip] ↑ดีขึ้น/↓แย่ลง X% จากช่วงก่อนหน้า”; แผนก/คน ป้าย ↑ดีขึ้น X%/↓แย่ลง X%/→เท่าเดิม
state เก่าไม่มี history ต้อง fallback ไม่ crash. typecheck + build ผ่าน
```

### เฟส C — ผูกคำแนะนำ → ผลลัพธ์ + ย่อ/ขยาย

```
ต่อจากเฟส B. ทำตาม §6 + §13.5 ของสเปก
1) เปลี่ยน actions ใน AiInsightResult เป็น structured {subjectType, subjectName, metricKey, detail, severity}; InsightMetricKey = overdue_tasks|pending_tasks|late_tasks|missed_reports|pending_reports|late_reports|open_total|success_rate; SYSTEM_PROMPT ให้ AI เลือก subjectName+metricKey จากที่ให้มาเท่านั้น
2) aggregate.ts: metricValueOf(agg, subjectType, subjectKey, metricKey):number
3) store key ใหม่ "ai-insight-ledger" (server-only). lib/ai-insight/ledger.ts: RecommendationRecord {id=hash(subjectType+subjectKey+metricKey), subjectType, subjectKey, subjectName, metricKey, detail, severity, issuedAt, baseline, latestValue, checkedAt, status:"open"|"improved"|"resolved"|"regressed", trail[]}; reconcile(ledger, agg, aiActions, now): record ใหม่ baseline=ค่าปัจจุบัน; record เดิมไม่ทับ baseline อัปเดต latestValue+push trail; record open วัดซ้ำทุกรอบ; ลงถึง 0 (lower-is-better)=resolved, ดีขึ้นแต่ยังไม่ถึง=improved, แย่กว่า baseline=regressed; subject/metric ไม่ match ให้ข้าม ไม่ throw; keep resolved ล่าสุด 20
4) analyze.ts: reconcile หลัง callOpenAiInsight เก็บ ledger; app/api/report-task/ai-insight/route.ts คืน departments+history+ledger ใน status
5) ai-insight-card.tsx: แท็บ “ผลของคำแนะนำ” แสดง “baseline → latest · ±delta (±%)” + ป้าย ✅แก้สำเร็จ/📈ดีขึ้น/➡️เท่าเดิม/⚠️แย่ลง; แยกกลุ่ม กำลังติดตาม vs แก้สำเร็จแล้ว; ทุกลิสต์ (คน/แผนก/ติดตามผล) ทำเป็น CollapsibleList แสดง 3 แถวแรก ที่เหลือใต้ปุ่ม “ดูเพิ่มอีก N รายการ ▾ / ย่อ ▴” (≤3 ไม่มีปุ่ม)
backward-compat: actions เก่าใน state เดิมต้องไม่ crash. typecheck + build ผ่าน
```

### หลังจบทุกเฟส
```
รัน typecheck + build ทั้ง workspace, ตรวจว่า state v1 เก่าโหลดการ์ดได้ไม่ crash, และยืนยันว่า ai-insight-history + ai-insight-ledger PUT จาก client route /api/report-task/store/[key] ไม่ได้ (ไม่อยู่ใน STORE_KEYS)
```

---

## 15. Remediation approach — สถานะ: ทำแล้ว

`AiInsightAction`/`AiInsightPersonNote`/`AiInsightDeptNote` เพิ่ม `approach?: string[]` (2–4 ขั้นตอนเจาะจง ไม่บังคับ) — SYSTEM_PROMPT ขอให้ AI ใส่เมื่อมีขั้นตอนจริงที่ควรบอก, ไม่ generic. UI: ปุ่ม "💡 แนวทางที่ AI แนะนำ ▾" ใต้ทุก action/personNote/deptNote ที่มี approach, ย่ออยู่โดย default (`ApproachToggle` ใน ai-insight-card.tsx). ยังไม่ทำ: hook แจ้งเตือน (§15.4) — รอมี notification infra จริง

## 16–17. Analyzer 3 ตัว + prompt เชื่อมข้อมูล — สถานะ: ทำแล้ว (logic), ไม่ได้ทำ (UI "wow")

`lib/ai-insight/analyzers/{root-cause,forecast,risk}.ts` — pure deterministic, ไม่เรียก OpenAI:
- `detectRootCauses(agg)`: 4 แบบตาม §16.1 (systemic-topic, concentration ≥40%, workload-imbalance ≥3×median, bottleneck-unit ≥50%), cap 3 เรียง severity
- `computeForecast(agg, history)`: closure velocity จาก history, doNothingRate extrapolate 14 วัน, clearByDays, confidence low ถ้า history <2 รอบ
- `detectRisks(agg, now)`: task ใกล้เลยกำหนดใน 48 ชม. + report topic ที่ยัง "pending" วันนี้ (ประมาณจากสถานะวันนี้ ไม่ได้คำนวณ cutoff วันถัดไปของแต่ละหัวข้อใหม่ทั้งหมดตามตัวอักษร §16.3 เป๊ะ — ยอมรับ trade-off นี้เพื่อความง่าย/เสี่ยงบั๊กน้อยกว่า)

ผลลัพธ์ทั้ง 3 เก็บใน `AiInsightState.rootCauses/forecast/risks`, ป้อนเข้า `buildPrompt` (openai-client.ts) ให้ insightText อ้างสาเหตุรากจริง ไม่ใช่แค่ผลลัพธ์ปลายทาง — แสดงใน UI เป็นบล็อก "สาเหตุที่พบ" / "พยากรณ์" / "ใกล้เลยกำหนดใน 48 ชม." ในแท็บภาพรวมบริษัท (การ์ด/ลิสต์แบบเดิม ไม่ใช่ hero + bottom-sheet ตาม §18)

## 18–19. Mobile "wow" UI (hero, compact summary, bottom-sheet) — สถานะ: ยังไม่ทำ

**เจตนา ไม่ใช่พลาด** — เลื่อนไว้ก่อนเพราะ: (1) เป็นงานออกแบบ UI ใหญ่/subjective ที่ควรวนดูรูปจริงกับผู้ใช้เป็นรอบๆ เหมือนที่ทำกับ KPI cards (§13.3) มากกว่าทำทีเดียวแบบเดา, (2) โค้ดจุดใกล้เคียง (`task-board-kpis.tsx`) มีคอมเมนต์เตือนไว้ชัดว่าเคยพัง production 3 รอบตอน redesign การ์ดสรุปแบบรวมชิ้นใหญ่ๆ, (3) ต้องมี mobile shell/bottom-sheet component ใหม่ทั้งกระบวน ทดสอบจริงบนมือถือไม่ได้ในสภาพแวดล้อมนี้ ทำเฟส D/E/F ที่เหลือ (mockup wow-mobile.html, wow-reco.html, compact-summary.html, BottomSheet component) เป็นรอบถัดไปเมื่อพร้อมทำ round ออกแบบ+รีวิวรูปจริง
