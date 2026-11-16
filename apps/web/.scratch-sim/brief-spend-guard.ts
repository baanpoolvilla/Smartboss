// ตัวกันเงิน (13/11/2569) — เพดานต้องกันก่อนเรียก AI + สรุปซ้ำไม่เกิน 2 ครั้ง + ค่าใช้จ่ายจริงต่อรอบด้วย terra
// ห้อง D (รอบเดียว 00:01 = ผลงาน) ใส่รายงานจริง 8 ฉบับ (เย็น 10/11) เป็นของวันนี้ · คืนค่าเดิมทั้งหมดตอนจบ
process.env.TENANT_GUARD = "strict";
import { readFileSync } from "node:fs";
import { prisma } from "@smartboss/database";
import { askBrief, listBriefs, runBossBriefSweep, startRangeBrief } from "@/modules/report_task/lib/boss-brief/server";
import type { BossBrief } from "@/modules/report_task/lib/boss-brief/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} | ${n}${x ? " | " + x : ""}`); };
const TOPIC = "topic-spend-guard-d";
const KEYS = ["report-feed", "boss-brief-settings", "boss-brief-usage", "boss-brief-locks"];

(async () => {
  const org = (await prisma.organization.findMany({ where: { code: { not: "TENANT-AI-B" } }, orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  const orgId = org.id;
  const backup = Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: k } } })])));
  const lab = JSON.parse(readFileSync("D:/Smartboss/apps/web/app/(shell)/report-brief-lab/data.json", "utf8")) as { reports: { at: string; round: string; text: string }[] };
  const staff = await prisma.user.findMany({ where: { orgId, isActive: true, NOT: { name: { contains: "@" } } }, select: { id: true }, take: 8 });
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const closed = new Date(Date.now() - 10 * 60_000);
  const ROUND_TIME = `${String(closed.getHours()).padStart(2, "0")}:${String(closed.getMinutes()).padStart(2, "0")}`;
  const month = today.slice(0, 7);
  const usageNow = async () => (((await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-usage" } } }))?.data as Record<string, { thb: number }> | undefined)?.[month]?.thb ?? 0);
  const setStore = async (key: string, data: unknown) => {
    const cur = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key } } });
    if (cur) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key } }, data: { data: data as never, version: cur.version + 1 } });
    else await prisma.reportTaskStore.create({ data: { orgId, key, data: data as never, version: 1 } });
  };
  try {
    const feed = JSON.parse(JSON.stringify(backup["report-feed"]!.data)) as { topics: Record<string, unknown>[]; posts: Record<string, unknown>[] };
    const base = feed.topics.find((t) => !t.archived) ?? feed.topics[0]!;
    const tpl = feed.posts.find((x) => x.sections) ?? {};
    feed.topics = [...feed.topics.filter((t) => t.id !== TOPIC), { ...base, id: TOPIC, name: "ทดสอบตัวกันเงิน", pinned: false, cutoffs: undefined, postTemplateSections: undefined, visibility: { mode: "everyone" }, postPermission: "everyone", createdAt: "2026-11-01T00:00:00.000Z", submissionRounds: [{ id: "r-d", label: "เย็น", time: ROUND_TIME, minImages: 0, createdAt: "2026-11-01T00:00:00.000Z", submitters: { mode: "everyone" } }] }];
    const reps = lab.reports.filter((r) => r.at.startsWith("2026-11-10") && r.round.includes("Evening"));
    const mk = (r: { text: string }, i: number, edited: string | null = null) => ({ ...tpl, id: `post-guard-${i}`, topicId: TOPIC, authorId: staff[i % staff.length]!.id, title: r.text.split("\n")[0], sections: [{ id: `s-guard-${i}`, heading: "", bullets: r.text.split("\n").slice(1) }], images: [], tagIds: [], createdAt: `${today}T00:${10 + i}:00.000Z`, editedAt: edited, pinned: false, savedBy: [], unreadFor: [], reactions: {}, replies: [], roundId: "r-d", excludeFromSubmission: false });
    feed.posts = [...feed.posts.filter((x) => x.topicId !== TOPIC), ...reps.map((r, i) => mk(r, i))];
    await setStore("report-feed", feed);
    const baseSettings = { ...((backup["boss-brief-settings"]?.data as object) ?? {}), enabled: true, topicIds: [TOPIC], modelVersion: 2, detailModel: "gpt-6.1-terra", askModel: "gpt-6.1-terra" };

    // 1) เงินเหลือไม่พอ → ไม่เรียก AI
    const u0 = await usageNow();
    await setStore("boss-brief-settings", { ...baseSettings, monthlyCapThb: Math.round((u0 + 0.2) * 100) / 100 });
    await runBossBriefSweep(orgId, new Date());
    let b = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    ok("เพดานใกล้เต็ม: สรุปหลังปิดรอบไม่เรียก AI", !!b && b.aiSkipped === "cap" && !b.detail, `ใช้ไป ฿${u0.toFixed(2)} เพดาน ฿${(u0 + 0.2).toFixed(2)}`);
    ok("…และไม่เสียเงิน", Math.abs((await usageNow()) - u0) < 0.001);
    const ask = await askBrief(orgId, b!.id, "สรุปให้หน่อย");
    ok("เพดานใกล้เต็ม: ถาม AI ถูกปฏิเสธก่อนเรียก", !ask.ok && /เพดาน/.test(ask.ok ? "" : ask.error), ask.ok ? "" : ask.error);
    const range = await startRangeBrief(orgId, TOPIC, today, today);
    ok("เพดานใกล้เต็ม: สรุปรวมไม่เริ่ม", !range.ok, range.ok ? "" : range.error);
    ok("…ทั้งหมดนี้ไม่เสียเงิน", Math.abs((await usageNow()) - u0) < 0.001);

    // 2) เพดานพอ → สรุปจริงด้วย terra
    await prisma.reportBossBrief.deleteMany({ where: { orgId, topicId: TOPIC } });
    await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-locks" } });
    await setStore("boss-brief-settings", { ...baseSettings, monthlyCapThb: 300 });
    const t0 = Date.now();
    await runBossBriefSweep(orgId, new Date());
    b = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    const u1 = await usageNow();
    ok("เพดานพอ: สรุปละเอียดได้ (terra)", !!b?.detail && b.model === "gpt-6.1-terra", `${reps.length} รายงาน · ฿${(u1 - u0).toFixed(2)} · ${Math.round((Date.now() - t0) / 1000)} วิ`);
    console.log("   ภาพรวม:", b?.headline);
    console.log("   เรื่องที่ต้องรู้:", JSON.stringify({ urgent: b?.detail?.urgent.map((x) => x.title), decide: b?.detail?.decisions.map((x) => x.what), carry: b?.detail?.carry.length }));

    // 3) สรุปซ้ำเมื่อแก้โพสต์ ไม่เกิน 2 ครั้ง (รอบเพิ่งปิด 10 นาที — อยู่ในช่วง 3 ชั่วโมง)
    const regens: number[] = [];
    for (let i = 0; i < 3; i++) {
      // แก้โพสต์ + ทำให้สรุปเดิม "เก่ากว่า 10 นาที" (ไม่ต้องรอจริง)
      const f = (await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "report-feed" } } }))!.data as typeof feed;
      f.posts = f.posts.map((p) => (p.id === "post-guard-0" ? { ...p, editedAt: new Date(Date.now() + i * 1000).toISOString() } : p));
      await setStore("report-feed", f);
      const cur = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0]!;
      const aged: BossBrief = { ...cur, generatedAt: new Date(Date.now() - 20 * 60_000).toISOString() };
      await prisma.reportBossBrief.update({ where: { orgId_id: { orgId, id: cur.id } }, data: { data: aged as never } });
      await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-locks" } });
      await runBossBriefSweep(orgId, new Date());
      regens.push((await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0]!.regens ?? 0);
    }
    const u2 = await usageNow();
    ok("แก้โพสต์ 3 ครั้ง → สรุปซ้ำแค่ 2 ครั้ง", JSON.stringify(regens) === "[1,2,2]", `regens ${JSON.stringify(regens)} · ค่าสรุปซ้ำรวม ฿${(u2 - u1).toFixed(2)}`);

    // 4) เลย 3 ชั่วโมงหลังปิดรอบ → ไม่สรุปซ้ำแม้มีการแก้
    await prisma.reportBossBrief.updateMany({ where: { orgId, topicId: TOPIC }, data: {} });
    const cur = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0]!;
    await prisma.reportBossBrief.update({ where: { orgId_id: { orgId, id: cur.id } }, data: { data: { ...cur, regens: 0, generatedAt: new Date(Date.now() - 20 * 60_000).toISOString() } as never } });
    const f2 = (await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "report-feed" } } }))!.data as typeof feed;
    f2.topics = f2.topics.map((t) => (t.id === TOPIC ? { ...t, submissionRounds: [{ ...(t.submissionRounds as Record<string, unknown>[])[0], time: "00:01" }] } : t));
    f2.posts = f2.posts.map((p) => (p.id === "post-guard-1" ? { ...p, editedAt: new Date().toISOString() } : p));
    await setStore("report-feed", f2);
    await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-locks" } });
    await runBossBriefSweep(orgId, new Date());
    const after = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0]!;
    ok("เลย 3 ชั่วโมงหลังปิดรอบ → ไม่สรุปซ้ำ ไม่เสียเงิน", (after.regens ?? 0) === 0 && Math.abs((await usageNow()) - u2) < 0.001);
  } finally {
    for (const k of KEYS) {
      const b = backup[k];
      const cur = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: k } } });
      if (b) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: k } }, data: { data: b.data as never, version: (cur?.version ?? 0) + 1 } });
      else if (cur) await prisma.reportTaskStore.delete({ where: { orgId_key: { orgId, key: k } } });
    }
    await prisma.reportBossBrief.deleteMany({ where: { orgId, topicId: TOPIC } });
    console.log("คืนค่าแล้ว");
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
