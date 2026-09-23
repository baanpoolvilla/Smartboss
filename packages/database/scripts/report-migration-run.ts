import { PrismaClient } from "@prisma/client";

/**
 * ย้ายโพสต์ของห้องรายงานรายแผนก เข้าห้องรวม Daily/Weekly/Monthly-report
 * (สรุปงาน-รวมห้องรายงาน 2026-09-23)
 *
 * ทำ 4 อย่างในทีเดียว — แยกทำไม่ได้ เพราะถ้าย้ายโพสต์ออกแต่ห้องเดิมยังมีรอบ+
 * ผู้ส่งอยู่ ตัวคิดคะแนนจะเห็นเป็น "มีคนต้องส่งแต่ไม่มีโพสต์เลย" แล้วไล่หัก
 * ขาดส่งย้อนหลังทุกวันทันที:
 *
 *  1. ย้ายโพสต์  topicId เดิม -> ห้องรวมตามประเภท (เวลาโพสต์เดิมไม่แตะ)
 *  2. ล้าง roundId + roundTimeAtSubmission ของโพสต์ที่ย้าย — ผู้ใช้สั่งว่า
 *     "ให้รอบส่งนั้นจับรอบใหม่หมดเลย" คือถือรอบใหม่เป็นตัวตัดสินอันเดียว
 *     ไม่ลากการผูกรอบเก่าตามมา (ค่า snapshot เวลาเดิมก็ต้องทิ้งด้วย ไม่งั้น
 *     โพสต์จะถูกตัดสินด้วยเวลาของรอบที่มันไม่ได้อยู่แล้ว)
 *  3. สร้างรอบในห้องรวม โดย "ลอก" จากรอบของห้องต้นทาง: จับกลุ่มตามเวลา+ตาราง
 *     วัน แล้วรวมรายชื่อผู้ส่งของทุกห้องที่มีรอบเวลานั้นเข้าด้วยกัน และตั้ง
 *     วันเริ่มใช้ย้อนไปเท่ากับรอบที่เก่าที่สุดในกลุ่ม -> ประวัติย้อนหลังจึง
 *     ออกมาตรงกับความจริงเดิม ไม่มีใครโดนตัดสินรอบที่ตัวเองไม่เคยต้องส่ง
 *     (ถ้ารอบเวลาเดียวกันมีอยู่แล้วในห้องรวม จะใช้ id เดิมต่อ ไม่สร้างใหม่ —
 *     โพสต์เดิมของห้องรวมที่ผูก id นั้นไว้จะได้ไม่หลุด)
 *  4. ปลดผู้ส่งของรอบในห้องต้นทางให้ว่าง — ห้องยังอยู่ครบ ดูย้อนหลังได้
 *     เหมือนเดิม แค่ไม่มีใครต้องส่งที่นั่นอีกแล้ว
 *
 * ไม่แตะ core.performance_events เลย — ledger คะแนนเป็นระบบ "เพิ่มอย่างเดียว
 * ไม่ลบ" ตัว sweep (report-penalty-sweep.ts) จะไล่คืนของเก่าที่ไม่ตรงแล้ว
 * ออก undo event ให้เอง และหักของใหม่ตามรอบในห้องรวม โดยยังมี enabledSince
 * เป็นพื้นกันย้อนหลังเกินไปเหมือนเดิม
 *
 * คืนค่าเดิมได้ทุกเมื่อด้วย report-migration-restore.ts (backup ก่อนรันเสมอ)
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/report-migration-run.ts --dry-run
 *      --morning-all   ใส่ทุกคนในรอบเช้า (ไม่ใช่แค่คนที่เคยมีรอบเช้าจริง)
 *      เอา --dry-run ออกเพื่อเขียนจริง
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const morningAll = process.argv.includes("--morning-all");
/**
 * --backdate = รอบในห้องรวมย้อนไปมีผลตั้งแต่วันที่รอบต้นทางเริ่มใช้ ทำให้ป้าย
 * ตรงเวลา/สาย และสถิติย้อนหลังของเดือนนี้ยังอยู่ครบ แลกกับการที่รอบเวลาเดียวกัน
 * ต้องแตกเป็นหลายรอบตามวันเริ่มของแต่ละห้อง (ไม่งั้นคนที่เริ่มทีหลังโดนนับ
 * ขาดส่งย้อนหลังในช่วงที่ตัวเองยังไม่มีภาระ)
 *
 * ค่าเริ่มต้น (ไม่ใส่ flag) = รอบเริ่มนับ "วันนี้" ตามที่เจ้าของระบบเลือก
 * ("ไม่ต้องซีเรียสรอบ ให้นับตั้งแต่วันที่ตั้งเลย ตัดปัญหา") — รอบสะอาด
 * ไม่มีใครโดนหักย้อนหลัง แลกกับสถิติย้อนหลังของเดือนนี้ที่จะเริ่มนับใหม่
 * (ตัวโพสต์ยังอยู่ครบทุกอัน หายเฉพาะตัวเลขสรุปที่คำนวณจากมัน)
 */
const backdate = process.argv.includes("--backdate");
const TODAY_ISO = new Date().toISOString();

type Frequency = "daily" | "weekly" | "monthly";

interface SubmitterRule {
  mode?: string;
  userIds?: string[];
  departmentIds?: string[];
  groupIds?: string[];
  addUserIds?: string[];
  removeUserIds?: string[];
}
interface RoundLike {
  id: string;
  label?: string;
  time?: string;
  weekdays?: number[];
  dayOfMonth?: number;
  minImages?: number;
  createdAt?: string;
  submitters?: SubmitterRule;
}
interface TopicLike {
  id: string;
  name: string;
  createdAt?: string;
  isCategory?: boolean;
  submissionRounds?: RoundLike[];
  cutoffs?: RoundLike[];
  requiredWeekdays?: number[];
  visibility?: { departmentIds?: string[]; userIds?: string[]; exemptUserIds?: string[]; managerOnly?: boolean };
}
interface PostLike {
  id: string;
  topicId: string;
  authorId: string;
  createdAt: string;
  roundId?: string;
  roundTimeAtSubmission?: string;
  excludeFromSubmission?: boolean;
}
interface ReportFeedSlice {
  topics?: TopicLike[];
  posts?: PostLike[];
  [k: string]: unknown;
}

function effectiveRounds(t: TopicLike): RoundLike[] {
  if (t.submissionRounds && t.submissionRounds.length > 0) return t.submissionRounds;
  if (!t.cutoffs || t.cutoffs.length === 0) return [];
  return t.cutoffs.map((c) => ({ ...c, weekdays: t.requiredWeekdays }));
}

function frequencyOf(t: TopicLike): Frequency | null {
  const rounds = effectiveRounds(t);
  if (rounds.length === 0) return null;
  if (rounds.some((r) => r.dayOfMonth != null)) return "monthly";
  if (rounds.some((r) => (r.weekdays?.length ?? 0) > 0 && (r.weekdays?.length ?? 0) < 7)) return "weekly";
  return "daily";
}

function mergeTargetOf(t: TopicLike): Frequency | null {
  const n = t.name.trim().toLowerCase();
  if (n === "daily-report") return "daily";
  if (n === "weekly-report") return "weekly";
  if (n === "monthly-report") return "monthly";
  return null;
}

/** คีย์ตาราง "เวลาเดียวกัน ตารางวันเดียวกัน" — ใช้จับคู่กับรอบเดิมที่มีอยู่แล้วในห้องรวม */
function scheduleKey(r: RoundLike): string {
  const days = r.dayOfMonth ? `m${r.dayOfMonth}` : (r.weekdays ?? []).slice().sort().join(",") || "all";
  return `${r.time ?? "--:--"}|${days}`;
}

/**
 * คีย์จับกลุ่มรอบตอนรวมห้อง = ตาราง + "วันเริ่มใช้"
 *
 * จงใจแยกตามวันเริ่มด้วย ไม่ยุบรวมทุกห้องที่เวลาตรงกันเป็นรอบเดียว เพราะแต่ละ
 * ห้องเริ่มใช้รอบคนละวัน (hk เย็นเริ่ม 15 ก.ย. แต่ sale เริ่ม 3 ก.ย. ฯลฯ) ถ้า
 * ยุบเป็นรอบเดียวแล้วใช้วันเก่าสุด คนที่เพิ่งเริ่มทีหลังจะโดนนับ "ขาดส่ง"
 * ย้อนหลังในช่วงที่ตัวเองยังไม่มีภาระต้องส่งด้วยซ้ำ (ประมาณ 29 วัน-คนจาก
 * ข้อมูลจริง) — ซึ่งไปหักคะแนนคนจริง ๆ ไม่ใช่แค่เลขในแดชบอร์ด
 *
 * ผลคือห้องรวมจะมีหลายรอบที่เวลาเดียวกันแต่คนละกลุ่มคน/คนละวันเริ่ม ซึ่งถูก
 * ต้องตามประวัติจริง — ยุบรวมทีหลังได้เสมอเมื่อประวัติช่วงนั้นผ่านไปแล้ว
 */
function groupKey(r: RoundLike): string {
  // โหมดเริ่มนับวันนี้: ทุกรอบเริ่มพร้อมกันหมด วันเริ่มเดิมไม่มีความหมายแล้ว
  // จับกลุ่มแค่ตาราง -> ได้รอบสะอาด 1 รอบต่อ 1 เวลา
  if (!backdate) return scheduleKey(r);
  return `${scheduleKey(r)}|${r.createdAt?.slice(0, 10) ?? "always"}`;
}

/** รายชื่อผู้ส่งของรอบ — เฉพาะ mode "people" ที่ระบุรายคนตรง ๆ เท่านั้นที่กาง
 * ออกมาได้ที่นี่ mode อื่น (แผนก/กลุ่ม/ทุกคน) ต้องอาศัยข้อมูลนอกสโตร์ จึงคง
 * rule เดิมไว้ทั้งก้อนแทนการแปลง — ข้อมูลจริงตอนนี้เป็น mode people ทุกห้อง
 * (ดูผล report-migration-inspect.ts) */
function peopleOf(r: RoundLike): string[] | null {
  const s = r.submitters;
  if (!s || s.mode !== "people") return null;
  const ids = new Set(s.userIds ?? []);
  for (const id of s.addUserIds ?? []) ids.add(id);
  for (const id of s.removeUserIds ?? []) ids.delete(id);
  return [...ids];
}

/**
 * รอบที่ผู้ส่งไม่ใช่ "รายคน" กางรายชื่อที่นี่ไม่ได้ — mode "everyone"/"departments"/
 * "groups" ต้องใช้ทะเบียนพนักงาน/กลุ่ม ซึ่งอยู่คนละสโตร์กับก้อนนี้ และระบบจริง
 * ตีความ "everyone" ว่า *ทุกคนที่เห็นห้อง* ถ้าสคริปต์เดาเองแล้วเดาพลาด จะกลาย
 * เป็นบังคับส่งคนที่ไม่ควรต้องส่ง (หรือหล่นคนที่ต้องส่ง) โดยไม่มีใครรู้ตัว
 *
 * จึงเลือกหยุดแทนการเดา: เจอรอบแบบนี้เมื่อไหร่ ให้คนตัดสินใจก่อนว่าจะเอายังไง
 */
function hasUnresolvableSubmitters(t: TopicLike): boolean {
  return effectiveRounds(t).some((r) => (r.submitters?.mode ?? "everyone") !== "people");
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}
function postMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function dayOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface PlannedRound {
  key: string;
  id: string;
  label: string;
  time: string;
  weekdays?: number[];
  dayOfMonth?: number;
  createdAt: string;
  people: string[];
  fromRounds: { topicName: string; roundId: string; people: number }[];
  reusedExistingId: boolean;
}

async function main() {
  const stores = await prisma.reportTaskStore.findMany({ where: { key: "report-feed" } });
  if (stores.length === 0) {
    console.log("ไม่พบสโตร์ report-feed");
    return;
  }

  for (const store of stores) {
    const data = store.data as unknown as ReportFeedSlice;
    const topics = data.topics ?? [];
    const posts = data.posts ?? [];

    console.log(`\n${"=".repeat(78)}`);
    console.log(`ORG ${store.orgId}   ${dryRun ? "[DRY-RUN — ยังไม่เขียนอะไร]" : "[เขียนจริง]"}`);
    console.log(
      backdate
        ? `โหมด --backdate : รอบย้อนไปมีผลตามวันเริ่มเดิมของแต่ละห้อง (ป้าย+สถิติย้อนหลังอยู่ครบ)`
        : `โหมดปกติ : รอบเริ่มนับวันนี้ (${TODAY_ISO.slice(0, 10)}) — โพสต์เก่าอยู่ครบแต่ไม่มีป้าย/สถิติย้อนหลัง`
    );
    if (morningAll) console.log(`โหมด --morning-all : ใส่ทุกคนในรอบเช้า`);
    console.log("=".repeat(78));

    const targets = new Map<Frequency, TopicLike>();
    for (const t of topics) {
      const kind = mergeTargetOf(t);
      if (kind && !targets.has(kind)) targets.set(kind, t);
    }
    // หยุดก่อนถ้ามีรอบที่กางรายชื่อผู้ส่งไม่ได้ — ดู hasUnresolvableSubmitters
    const risky = topics.filter((t) => frequencyOf(t) !== null && !t.isCategory && hasUnresolvableSubmitters(t));
    if (risky.length > 0) {
      console.log(`\n⚠ หยุดไว้ก่อน — มีห้องที่รอบตั้งผู้ส่งแบบไม่ใช่ "รายคน" ${risky.length} ห้อง:`);
      for (const t of risky) {
        for (const r of effectiveRounds(t)) {
          const mode = r.submitters?.mode ?? "(ไม่ระบุ)";
          if (mode !== "people") console.log(`   - ${t.name} · รอบ "${r.label ?? r.id}" ${r.time ?? ""} · mode=${mode}`);
        }
      }
      console.log(`\n  สคริปต์กางรายชื่อจากรอบพวกนี้เองไม่ได้ (ต้องใช้ทะเบียนพนักงาน/กลุ่ม)`);
      console.log(`  แก้ที่หน้าตั้งค่าห้องให้เป็น "เฉพาะบุคคล" ก่อน แล้วค่อยรันใหม่`);
      console.log(`  — หรือถ้ารู้อยู่แล้วว่าห้องพวกนี้ไม่มีคนต้องส่งจริง ก็ปลดผู้ส่งทิ้งได้เลย\n`);
      continue;
    }

    const missing = (["daily", "weekly", "monthly"] as Frequency[]).filter((k) => !targets.has(k));
    if (missing.length > 0) {
      console.log(`\nยังไม่มีห้องรวมสำหรับ: ${missing.join(", ")} — สร้างห้องชื่อ Daily-report / Weekly-report / Monthly-report ก่อน`);
      continue;
    }

    // ---------- วางแผนต่อประเภท ----------
    const plannedRoundsByFreq = new Map<Frequency, PlannedRound[]>();
    const movesByFreq = new Map<Frequency, PostLike[]>();
    const sourcesByFreq = new Map<Frequency, TopicLike[]>();

    for (const kind of ["daily", "weekly", "monthly"] as Frequency[]) {
      const target = targets.get(kind)!;
      // กันห้องที่ "ชื่อเป็นห้องรวม" ออกจากฝั่งต้นทางทั้งหมด ไม่ใช่แค่ห้องที่ถูก
      // เลือกเป็นเป้าหมาย — ข้อมูลจริงมีห้องชื่อ daily-report ซ้ำอีกห้อง (ว่างเปล่า)
      // ถ้าไม่กัน มันจะโผล่มาเป็นต้นทางและลากรอบเปล่า ๆ เข้ามาปนในแผน
      const sources = topics.filter((t) => frequencyOf(t) === kind && mergeTargetOf(t) === null && !t.isCategory);
      sourcesByFreq.set(kind, sources);
      movesByFreq.set(kind, posts.filter((p) => sources.some((s) => s.id === p.topicId)));

      // จับกลุ่มรอบของห้องต้นทางตาม เวลา + ตารางวัน + วันเริ่มใช้ (ดู groupKey)
      const groups = new Map<string, { rounds: { topic: TopicLike; round: RoundLike }[] }>();
      for (const s of sources) {
        for (const r of effectiveRounds(s)) {
          const key = groupKey(r);
          const g = groups.get(key) ?? { rounds: [] };
          g.rounds.push({ topic: s, round: r });
          groups.set(key, g);
        }
      }

      const existingTargetRounds = effectiveRounds(target);
      const usedExistingIds = new Set<string>();
      const planned: PlannedRound[] = [];

      for (const [key, g] of groups) {
        const first = g.rounds[0]!.round;
        // รายชื่อผู้ส่ง = รวมของทุกห้องในกลุ่มนี้ (เวลา+ตาราง+วันเริ่ม ตรงกันหมด)
        const people = new Set<string>();
        for (const { round } of g.rounds) for (const id of peopleOf(round) ?? []) people.add(id);
        // โหมดย้อนหลัง: ทุกรอบในกลุ่มมีวันเริ่มเดียวกันอยู่แล้ว (เป็นส่วนหนึ่งของคีย์)
        // โหมดปกติ: เริ่มนับวันนี้ทั้งหมด ไม่ตัดสินย้อนหลังเลยสักวัน
        const createdAt = backdate ? (first.createdAt ?? "") : TODAY_ISO;
        // ใช้ id ของรอบเดิมในห้องรวมถ้าตารางตรงกัน — โพสต์เดิมของห้องรวมจะได้ไม่หลุด
        // ใช้ซ้ำได้รอบเดียวเท่านั้น กลุ่มที่เหลือของเวลาเดียวกันต้องเป็นรอบใหม่
        const reuse = existingTargetRounds.find((r) => scheduleKey(r) === scheduleKey(first) && !usedExistingIds.has(r.id));
        if (reuse) usedExistingIds.add(reuse.id);

        planned.push({
          key,
          id: reuse?.id ?? `round-${crypto.randomUUID()}`,
          label: first.label ?? `รอบ ${first.time ?? ""}`.trim(),
          time: first.time ?? "18:00",
          weekdays: first.weekdays,
          dayOfMonth: first.dayOfMonth,
          createdAt,
          people: [...people],
          fromRounds: g.rounds.map(({ topic, round }) => ({
            topicName: topic.name,
            roundId: round.id,
            people: (peopleOf(round) ?? []).length,
          })),
          reusedExistingId: !!reuse,
        });
      }

      // รอบที่เวลาเดียวกันแต่คนละกลุ่มวันเริ่ม จะมีหลายอันชื่อซ้ำกัน — ต่อท้าย
      // ด้วยวันเริ่มให้แยกออกจากกันในหน้าตั้งค่า ไม่งั้นเห็น "Daily-report-Evening"
      // 4 อันเรียงกันแล้วแยกไม่ออกว่าอันไหนของใคร
      const labelCount = new Map<string, number>();
      for (const p of planned) labelCount.set(p.label, (labelCount.get(p.label) ?? 0) + 1);
      for (const p of planned) {
        if (backdate && (labelCount.get(p.label) ?? 0) > 1 && p.createdAt) {
          const d = new Date(p.createdAt);
          p.label = `${p.label} · เริ่ม ${d.getDate()}/${d.getMonth() + 1}`;
        }
      }

      // --morning-all : รอบที่ไม่ใช่รอบสุดท้ายของวัน (เช้า) ให้ใส่ทุกคนที่ส่งประเภทนี้
      if (morningAll && planned.length > 1) {
        const everyone = new Set<string>();
        for (const p of planned) for (const id of p.people) everyone.add(id);
        const latest = planned.slice().sort((a, b) => minutesOf(b.time) - minutesOf(a.time))[0]!;
        for (const p of planned) if (p.key !== latest.key) p.people = [...everyone];
      }

      planned.sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
      plannedRoundsByFreq.set(kind, planned);
    }

    // ---------- พิมพ์แผน ----------
    for (const kind of ["daily", "weekly", "monthly"] as Frequency[]) {
      const target = targets.get(kind)!;
      const sources = sourcesByFreq.get(kind)!;
      const moves = movesByFreq.get(kind)!;
      const planned = plannedRoundsByFreq.get(kind)!;
      const ownBefore = posts.filter((p) => p.topicId === target.id).length;

      console.log(`\n--- ${kind.toUpperCase()}  ->  "${target.name}" ---`);
      console.log(`  โพสต์เดิมของห้องรวม ${ownBefore} · จะย้ายเข้ามาอีก ${moves.length} · รวมเป็น ${ownBefore + moves.length}`);
      for (const s of sources) {
        const n = moves.filter((p) => p.topicId === s.id).length;
        if (n > 0) console.log(`     ${String(n).padStart(4)} โพสต์  จาก  ${s.name}`);
      }

      console.log(`\n  รอบที่จะมีในห้องรวม:`);
      for (const p of planned) {
        const sched = p.dayOfMonth
          ? `ทุกวันที่ ${p.dayOfMonth}`
          : p.weekdays && p.weekdays.length > 0 && p.weekdays.length < 7
            ? `ทุกวัน${p.weekdays.map((d) => ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"][d] ?? d).join("/")}`
            : "ทุกวัน";
        console.log(
          `     · "${p.label}" ${p.time} · ${sched} · ผู้ส่ง ${p.people.length} คน` +
            ` · เริ่มใช้ ${p.createdAt ? p.createdAt.slice(0, 10) : "(ไม่จำกัด = ย้อนหลังได้ทุกวัน)"}` +
            `${p.reusedExistingId ? " · ใช้รอบเดิมของห้องรวมต่อ" : " · รอบใหม่"}`
        );
        for (const f of p.fromRounds) console.log(`         ลอกจาก ${f.topicName} (${f.people} คน)`);
      }

      // ประเมินผลการจับรอบของโพสต์ที่ย้าย — ตรงเวลา/สาย กี่อัน
      if (moves.length > 0 && planned.length > 0) {
        const byRound = new Map<string, { onTime: number; late: number }>();
        for (const p of moves) {
          if (p.excludeFromSubmission) continue;
          const day = dayOf(p.createdAt);
          const candidates = planned.filter((r) => {
            if (r.createdAt && day < r.createdAt.slice(0, 10)) return false;
            if (r.dayOfMonth) return new Date(`${day}T00:00:00`).getDate() === r.dayOfMonth;
            if (r.weekdays && r.weekdays.length > 0 && r.weekdays.length < 7) {
              return r.weekdays.includes(new Date(`${day}T00:00:00`).getDay());
            }
            return true;
          });
          if (candidates.length === 0) continue;
          const mins = postMinutes(p.createdAt);
          const hit = candidates.find((r) => minutesOf(r.time) >= mins) ?? candidates[candidates.length - 1]!;
          const acc = byRound.get(hit.key) ?? { onTime: 0, late: 0 };
          if (mins <= minutesOf(hit.time)) acc.onTime += 1;
          else acc.late += 1;
          byRound.set(hit.key, acc);
        }
        console.log(`\n  โพสต์ที่ย้ายมา จะถูกจับเข้ารอบใหม่แบบนี้:`);
        for (const p of planned) {
          const acc = byRound.get(p.key) ?? { onTime: 0, late: 0 };
          console.log(`     · ${p.label} ${p.time} : ตรงเวลา ${acc.onTime} · สาย ${acc.late}`);
        }
        const judged = [...byRound.values()].reduce((n, a) => n + a.onTime + a.late, 0);
        const skipped = moves.filter((p) => !p.excludeFromSubmission).length - judged;
        if (skipped > 0) console.log(`     · ไม่เข้ารอบไหนเลย (วันนั้นไม่มีรอบวิ่ง) : ${skipped}`);
      }

      const neutralize = sources.flatMap((s) => effectiveRounds(s).map((r) => ({ topic: s.name, round: r.label ?? r.id })));
      if (neutralize.length > 0) {
        console.log(`\n  รอบของห้องเดิมที่จะถูกปลดผู้ส่งออก (ห้องยังอยู่ ดูย้อนหลังได้): ${neutralize.length} รอบ`);
      }
    }

    if (dryRun) {
      console.log(`\n[dry-run] ยังไม่เขียนอะไรลงฐานข้อมูล — เอา --dry-run ออกเพื่อทำจริง\n`);
      continue;
    }

    // ---------- เขียนจริง ----------
    const movedIds = new Map<string, string>(); // postId -> target topicId
    for (const kind of ["daily", "weekly", "monthly"] as Frequency[]) {
      const target = targets.get(kind)!;
      for (const p of movesByFreq.get(kind)!) movedIds.set(p.id, target.id);
    }

    const nextPosts = posts.map((p) => {
      const to = movedIds.get(p.id);
      if (!to) return p;
      const { roundId, roundTimeAtSubmission, ...rest } = p;
      void roundId;
      void roundTimeAtSubmission;
      return { ...rest, topicId: to };
    });

    const plannedByTargetId = new Map<string, PlannedRound[]>();
    for (const kind of ["daily", "weekly", "monthly"] as Frequency[]) {
      plannedByTargetId.set(targets.get(kind)!.id, plannedRoundsByFreq.get(kind)!);
    }
    const sourceIds = new Set<string>();
    for (const kind of ["daily", "weekly", "monthly"] as Frequency[]) {
      for (const s of sourcesByFreq.get(kind)!) sourceIds.add(s.id);
    }

    const nextTopics = topics.map((t) => {
      const planned = plannedByTargetId.get(t.id);
      if (planned) {
        return {
          ...t,
          submissionRounds: planned.map((p) => ({
            id: p.id,
            label: p.label,
            time: p.time,
            ...(p.weekdays && p.weekdays.length > 0 && p.weekdays.length < 7 ? { weekdays: p.weekdays } : {}),
            ...(p.dayOfMonth ? { dayOfMonth: p.dayOfMonth } : {}),
            ...(p.createdAt ? { createdAt: p.createdAt } : {}),
            submitters: { mode: "people" as const, userIds: p.people },
          })),
        };
      }
      // ปลดผู้ส่งของ "ทุกห้องรายงานที่ไม่ใช่ห้องรวมเป้าหมาย" ไม่ใช่แค่ห้องต้นทาง —
      // ห้องที่ชื่อซ้ำกับห้องรวม (ข้อมูลจริงมีห้อง daily-report ซ้ำอีกห้อง) ถูกกันออก
      // จากฝั่งต้นทางไปแล้ว ถ้าไม่ปลดตรงนี้ด้วย มันจะยังบังคับส่งค้างอยู่เงียบ ๆ
      // แล้วกลายเป็นภาระเกินที่ไม่มีใครรู้ที่มา
      const isTarget = plannedByTargetId.has(t.id);
      if (!isTarget && frequencyOf(t) !== null && !t.isCategory) {
        // เก็บรอบไว้ทั้งหมด (ยังใช้จัดประเภทห้อง + ดูย้อนหลัง) แต่ไม่มีใครต้องส่งแล้ว
        const rounds = effectiveRounds(t).map((r) => ({ ...r, submitters: { mode: "people" as const, userIds: [] } }));
        return { ...t, submissionRounds: rounds };
      }
      return t;
    });

    const nextData: ReportFeedSlice = { ...data, topics: nextTopics, posts: nextPosts };

    await prisma.reportTaskStore.update({
      where: { orgId_key: { orgId: store.orgId, key: "report-feed" } },
      data: { data: nextData as never, version: { increment: 1 } },
    });

    console.log(`\nย้ายเรียบร้อย — โพสต์ ${movedIds.size} อันเข้าห้องรวมแล้ว`);
    console.log(`บอกทุกคนรีเฟรชหน้าจอหนึ่งรอบ แล้วเช็คผลทันทีก่อนมีใครโพสต์ใหม่`);
    console.log(`ไม่โอเคย้อนกลับได้ด้วย report-migration-restore.ts\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
