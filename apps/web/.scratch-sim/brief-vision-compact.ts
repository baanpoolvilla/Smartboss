// อ่านรูปในรายงาน weekly + ย่อสรุปเก่า (13/11/2569) — ทดสอบกับฐานข้อมูลในเครื่อง แล้วคืนค่าเดิม
// ห้อง C (รอบรายสัปดาห์ = ส่งวันเดียวในสัปดาห์ = วันนี้) 2 รายงานที่ข้อมูลอยู่ในรูป → รอบตรวจ → ดูว่า AI อ่านตัวเลขในรูปได้
// รอบสอง: ลบสรุปแล้วสรุปใหม่ → ต้องใช้ข้อความรูปที่เก็บไว้ (ไม่อ่านรูปซ้ำ)
// ย่อ: ใส่สรุปอายุ 400 วัน → compactOldBriefs → เหลือแบบย่อ
process.env.TENANT_GUARD = "strict";
import { readFileSync } from "node:fs";
import { prisma } from "@smartboss/database";
import { compactOldBriefs, listBriefs, readImageTextStore, runBossBriefSweep } from "@/modules/report_task/lib/boss-brief/server";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} | ${n}${x ? " | " + x : ""}`); };
const DIR = process.argv[2]!;
const TOPIC = "topic-brief-vision-c";
const img = (f: string) => `data:image/png;base64,${readFileSync(`${DIR}/${f}`).toString("base64")}`;

(async () => {
  const org = (await prisma.organization.findMany({ where: { code: { not: "TENANT-AI-B" } }, orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  const orgId = org.id;
  const staff = await prisma.user.findMany({ where: { orgId, isActive: true, name: { in: ["ม่อง (คนงาน)", "ต้น (ช่าง)"] } }, select: { id: true, name: true } });
  const feedRow = (await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "report-feed" } } }))!;
  const setRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-settings" } } });
  const imgRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-image-text" } } });
  const usageRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-usage" } } });
  const now = new Date();
  const today = new Date(now.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  const wd = new Date(`${today}T12:00:00`).getDay();
  try {
    const data = JSON.parse(JSON.stringify(feedRow.data)) as { topics: Record<string, unknown>[]; posts: Record<string, unknown>[] };
    const base = data.topics.find((t) => !t.archived) ?? data.topics[0]!;
    const tpl = data.posts.find((x) => x.sections) ?? {};
    data.topics = [...data.topics.filter((t) => t.id !== TOPIC), {
      ...base, id: TOPIC, name: "ทดสอบ Weekly (อ่านรูป)", description: "", pinned: false, cutoffs: undefined, postTemplateSections: undefined,
      visibility: { mode: "everyone" }, postPermission: "everyone", createdAt: "2026-11-01T00:00:00.000Z",
      submissionRounds: [{ id: "r-c-week", label: "Weekly", time: "00:01", weekdays: [wd], minImages: 0, createdAt: "2026-11-01T00:00:00.000Z", submitters: { mode: "everyone" } }],
    }];
    const post = (i: number, who: { id: string }, title: string, file: string) => ({
      ...tpl, id: `post-vision-${i}`, topicId: TOPIC, authorId: who.id, title, sections: [{ id: `s-vision-${i}`, heading: "", bullets: ["รายละเอียดตามรูปที่แนบ"] }],
      images: [{ id: `img-vision-${i}`, name: file, dataUrl: img(file), mime: "image/png" }], tagIds: [], createdAt: `${today}T00:${10 + i}:00.000Z`, editedAt: null,
      pinned: false, savedBy: [], unreadFor: [], reactions: {}, replies: [], roundId: "r-c-week", excludeFromSubmission: false,
    });
    data.posts = [...data.posts.filter((x) => x.topicId !== TOPIC), post(1, staff[0]!, "Weekly Report ฝ่ายขาย", "sales.png"), post(2, staff[1] ?? staff[0]!, "Weekly Report ทีมช่าง", "maint.png")];
    await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: "report-feed" } }, data: { data: data as never, version: feedRow.version + 1 } });
    const settings = { ...((setRow?.data as object) ?? {}), enabled: true, topicIds: [TOPIC] };
    await prisma.reportTaskStore.upsert({ where: { orgId_key: { orgId, key: "boss-brief-settings" } }, create: { orgId, key: "boss-brief-settings", data: settings, version: 1 }, update: { data: settings, version: (setRow?.version ?? 0) + 1 } });

    const usage0 = ((usageRow?.data as Record<string, { thb: number }>) ?? {})[today.slice(0, 7)]?.thb ?? 0;
    const t0 = Date.now();
    const r1 = await runBossBriefSweep(orgId, now);
    const b1 = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    const store = await readImageTextStore(orgId);
    const texts = Object.entries(store).filter(([k]) => k.startsWith("post-vision-"));
    ok("รอบตรวจสรุปห้อง weekly ได้", r1.made === 1 && !!b1?.detail, `${Math.round((Date.now() - t0) / 1000)} วิ`);
    ok("สรุปบอกว่าเป็นรายสัปดาห์", b1?.detail?.period === "weekly");
    ok("อ่านรูปแล้วเก็บข้อความไว้ 2 รูป", texts.length === 2);
    const all = JSON.stringify(b1);
    ok("AI เห็นตัวเลขจากรูป (ยอดจอง 1,284,500 / ค่าอะไหล่ 18,750)", /1,?284,?500/.test(all + JSON.stringify(store)) && /18,?750/.test(all + JSON.stringify(store)));
    ok("AI จับเรื่องรอ Boss อนุมัติซื้ออะไหล่ปั๊ม HS2 จากในรูป", /อะไหล่|ปั๊ม/.test(JSON.stringify(b1?.detail?.decisions ?? []) + JSON.stringify(b1?.detail?.urgent ?? [])));
    const usage1 = ((await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-usage" } } }))?.data as Record<string, { thb: number }>)[today.slice(0, 7)]?.thb ?? 0;
    console.log("\nข้อความที่อ่านจากรูป:\n" + texts.map(([k, v]) => `[${k}]\n${v.text}`).join("\n\n"));
    console.log("\nเรื่องที่ต้องรู้:", JSON.stringify({ urgent: b1?.detail?.urgent.map((u) => u.title), decisions: b1?.detail?.decisions.map((d) => d.what) }));
    console.log(`ค่าใช้จ่ายรอบแรก (อ่านรูป + สรุป): ฿${(usage1 - usage0).toFixed(2)}`);

    // สรุปใหม่ → ไม่ต้องอ่านรูปซ้ำ
    await prisma.reportBossBrief.deleteMany({ where: { orgId, topicId: TOPIC } });
    await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-locks" } });
    await runBossBriefSweep(orgId, now);
    const usage2 = ((await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-usage" } } }))?.data as Record<string, { thb: number }>)[today.slice(0, 7)]?.thb ?? 0;
    const b2 = (await listBriefs(orgId, { topicId: TOPIC, isRange: false }))[0];
    ok("สรุปรอบสองใช้ข้อความรูปที่เก็บไว้ (ไม่อ่านรูปซ้ำ)", Object.keys(await readImageTextStore(orgId)).filter((k) => k.startsWith("post-vision-")).length === 2 && !!b2?.detail, `รอบสอง ฿${(usage2 - usage1).toFixed(2)} (สรุปอย่างเดียว)`);

    // ย่อสรุปเก่ากว่า 12 เดือน
    const old = { ...b2!, id: `2025-10-01|${TOPIC}|r-c-week`, day: "2025-10-01" };
    await prisma.reportBossBrief.create({ data: { orgId, id: old.id, topicId: TOPIC, day: old.day, isRange: false, data: old as never, generatedAt: new Date() } });
    const before = JSON.stringify(old).length;
    const n = await compactOldBriefs(orgId);
    const after = (await prisma.reportBossBrief.findUnique({ where: { orgId_id: { orgId, id: old.id } } }))!.data as { compact?: boolean; detail?: { people: object } };
    ok("ย่อสรุปเก่ากว่า 12 เดือน", n >= 1 && after.compact === true && Object.keys(after.detail?.people ?? {}).length === 0, `${(before / 1024).toFixed(1)} KB → ${(JSON.stringify(after).length / 1024).toFixed(1)} KB`);
    ok("สรุปปีนี้ไม่ถูกย่อ", !((await prisma.reportBossBrief.findUnique({ where: { orgId_id: { orgId, id: b2!.id } } }))!.data as { compact?: boolean }).compact);
  } finally {
    const cur = (await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "report-feed" } } }))!;
    await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: "report-feed" } }, data: { data: feedRow.data as never, version: cur.version + 1 } });
    const s2 = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-settings" } } });
    if (setRow) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: "boss-brief-settings" } }, data: { data: setRow.data as never, version: (s2?.version ?? 0) + 1 } });
    else await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-settings" } });
    const i2 = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-image-text" } } });
    if (imgRow) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: "boss-brief-image-text" } }, data: { data: imgRow.data as never, version: (i2?.version ?? 0) + 1 } });
    else await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "boss-brief-image-text" } });
    await prisma.reportBossBrief.deleteMany({ where: { orgId, topicId: TOPIC } });
    console.log("คืนค่าแล้ว");
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
