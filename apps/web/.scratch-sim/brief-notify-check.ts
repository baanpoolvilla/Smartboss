// แจ้งเตือนสรุปซ้ำ + เพิ่มเพดานแล้วสรุปให้ (13/11/2569) — ฐานข้อมูลในเครื่อง คืนค่าเดิมตอนจบ
// ห้อง F รอบเพิ่งปิด 10 นาที: (1) เงินไม่พอ → ข้าม (2) เพิ่มเพดาน → สรุปให้เอง + แจ้ง "พร้อมแล้ว"
// (3) ส่งเพิ่ม 4 คน → สรุปซ้ำ + แจ้ง "ส่งเพิ่ม 4 คน" (4) แก้คำในโพสต์อย่างเดียว → สรุปซ้ำแต่ไม่แจ้ง
process.env.TENANT_GUARD = "strict";
import { readFileSync } from "node:fs";
import { prisma } from "@smartboss/database";
import { listBriefs, runBossBriefSweep } from "@/modules/report_task/lib/boss-brief/server";
import type { BossBrief } from "@/modules/report_task/lib/boss-brief/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} | ${n}${x ? " | " + x : ""}`); };
const TOPIC = "topic-notify-f";
const KEYS = ["report-feed", "boss-brief-settings", "boss-brief-usage", "boss-brief-locks", "notifications"];

(async () => {
  const org = (await prisma.organization.findMany({ where: { code: { not: "TENANT-AI-B" } }, orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  const orgId = org.id;
  const backup = Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: k } } })])));
  const lab = JSON.parse(readFileSync("D:/Smartboss/apps/web/app/(shell)/report-brief-lab/data.json", "utf8")) as { reports: { at: string; round: string; text: string }[] };
  const staff = await prisma.user.findMany({ where: { orgId, isActive: true, NOT: { name: { contains: "@" } } }, select: { id: true }, take: 8 });
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const closed = new Date(Date.now() - 10 * 60_000);
  const ROUND_TIME = `${String(closed.getHours()).padStart(2, "0")}:${String(closed.getMinutes()).padStart(2, "0")}`;
  const usageNow = async () => (((await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-usage" } } }))?.data as Record<string, { thb: number }> | undefined)?.[month]?.thb ?? 0);
  const setStore = async (key: string, data: unknown) => {
    const cur = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key } } });
    if (cur) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key } }, data: { data: data as never, version: cur.version + 1 } });
    else await prisma.reportTaskStore.create({ data: { orgId, key, data: data as never, version: 1 } });
  };
  const myNotifs = async () => (((await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "notifications" } } }))?.data as { id: string; message: string }[] | undefined) ?? []).filter((n) => n.id.includes(TOPIC));
  const age = async () => {
    const cur = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0]!;
    await prisma.reportBossBrief.update({ where: { orgId_id: { orgId, id: cur.id } }, data: { data: { ...cur, generatedAt: new Date(Date.now() - 20 * 60_000).toISOString() } as BossBrief as never } });
    await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-locks" } });
  };
  try {
    const feed = JSON.parse(JSON.stringify(backup["report-feed"]!.data)) as { topics: Record<string, unknown>[]; posts: Record<string, unknown>[] };
    const base = feed.topics.find((t) => !t.archived) ?? feed.topics[0]!;
    const tpl = feed.posts.find((x) => x.sections) ?? {};
    feed.topics = [...feed.topics.filter((t) => t.id !== TOPIC), { ...base, id: TOPIC, name: "ทดสอบแจ้งเตือนสรุป", pinned: false, cutoffs: undefined, postTemplateSections: undefined, visibility: { mode: "everyone" }, postPermission: "everyone", createdAt: "2026-11-01T00:00:00.000Z", submissionRounds: [{ id: "r-f", label: "เย็น", time: ROUND_TIME, minImages: 0, createdAt: "2026-11-01T00:00:00.000Z", submitters: { mode: "everyone" } }] }];
    const reps = lab.reports.filter((r) => r.at.startsWith("2026-11-10") && r.round.includes("Evening"));
    const mk = (r: { text: string }, i: number) => ({ ...tpl, id: `post-notify-${i}`, topicId: TOPIC, authorId: staff[i % staff.length]!.id, title: r.text.split("\n")[0], sections: [{ id: `s-notify-${i}`, heading: "", bullets: r.text.split("\n").slice(1) }], images: [], tagIds: [], createdAt: `${today}T00:${10 + i}:00.000Z`, editedAt: null, pinned: false, savedBy: [], unreadFor: [], reactions: {}, replies: [], roundId: "r-f", excludeFromSubmission: false });
    const firstHalf = [0, 1, 3, 5].map((i) => mk(reps[i]!, i)); // ยังไม่มีเรื่องสินเชื่อ SL1 (รายงาน 6) — รอบแรกยังไม่ครบ
    feed.posts = [...feed.posts.filter((x) => x.topicId !== TOPIC), ...firstHalf];
    await setStore("report-feed", feed);
    const s = { ...((backup["boss-brief-settings"]?.data as object) ?? {}), enabled: true, topicIds: [TOPIC], modelVersion: 2, detailModel: "gpt-6.1-terra", askModel: "gpt-6.1-terra" };

    // 1) เงินไม่พอ
    const u0 = await usageNow();
    await setStore("boss-brief-settings", { ...s, monthlyCapThb: Math.ceil(u0 + 0.2) });
    await runBossBriefSweep(orgId, new Date());
    let b = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    ok("เงินไม่พอ → ข้าม AI", b?.aiSkipped === "cap");
    // 2) เพิ่มเพดาน → รอบถัดไปสรุปให้เอง
    await setStore("boss-brief-settings", { ...s, monthlyCapThb: 300 });
    await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-locks" } });
    await runBossBriefSweep(orgId, new Date());
    b = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    let n = await myNotifs();
    ok("เพิ่มเพดาน → สรุปให้เองทันที (ไม่นับเป็นสรุปซ้ำ)", !!b?.detail && !b.aiSkipped && (b.regens ?? 0) === 0, `฿${((await usageNow()) - u0).toFixed(2)}`);
    ok("…และแจ้ง Boss ว่าสรุปพร้อม", n.some((x) => x.id.includes("|cap|") && /พร้อมแล้ว/.test(x.message)), n.map((x) => x.message).join(" / "));
    // 3) ส่งเพิ่ม 4 คน (รวมรายงานสินเชื่อ SL1 ที่มีเรื่องด่วน)
    const f = (await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "report-feed" } } }))!.data as typeof feed;
    f.posts = [...f.posts, ...[2, 4, 6, 7].map((i) => mk(reps[i]!, i))];
    await setStore("report-feed", f);
    await age();
    await runBossBriefSweep(orgId, new Date());
    b = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    n = await myNotifs();
    const upd = n.find((x) => x.id.includes("|u1|"));
    ok("ส่งเพิ่ม → สรุปซ้ำ + แจ้ง Boss ว่ามีอะไรใหม่", (b?.regens ?? 0) === 1 && !!upd && /ส่งเพิ่ม 4 คน/.test(upd.message), upd?.message ?? "ไม่มีแจ้งเตือน");
    // 4) แก้คำในโพสต์อย่างเดียว → สรุปซ้ำ แต่ไม่แจ้ง
    const f2 = (await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "report-feed" } } }))!.data as typeof feed;
    f2.posts = f2.posts.map((p) => (p.id === "post-notify-0" ? { ...p, editedAt: new Date().toISOString(), title: `${p.title} (แก้คำผิด)` } : p));
    await setStore("report-feed", f2);
    await age();
    const before = (await myNotifs()).length;
    await runBossBriefSweep(orgId, new Date());
    b = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    const after = await myNotifs();
    ok("แก้คำในโพสต์อย่างเดียว → สรุปซ้ำแต่ไม่แจ้ง", (b?.regens ?? 0) === 2 && after.length === before, after.length > before ? after.at(-1)!.message : "");
    console.log("แจ้งเตือนทั้งหมด:\n" + after.map((x) => " - " + x.message).join("\n"));
  } finally {
    for (const k of KEYS) {
      const bk = backup[k];
      const cur = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: k } } });
      if (bk) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: k } }, data: { data: bk.data as never, version: (cur?.version ?? 0) + 1 } });
      else if (cur) await prisma.reportTaskStore.delete({ where: { orgId_key: { orgId, key: k } } });
    }
    await prisma.reportBossBrief.deleteMany({ where: { orgId, topicId: TOPIC } });
    console.log("คืนค่าแล้ว");
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
