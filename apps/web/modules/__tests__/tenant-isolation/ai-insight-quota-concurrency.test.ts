import { test } from "node:test";
import assert from "node:assert/strict";

import { reserveQuotaSlot, refundQuotaSlot } from "@/modules/report_task/lib/ai-insight/analyze";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { withOrgPair } from "./harness";

/**
 * fix-list ข้อ 2 — AI Insight quota เป็น hard entitlement ผูกแพ็กเกจขายจริง
 * (FREE/PRO/ENTERPRISE) ไม่ใช่แค่กันเผื่อภายใน ทั้ง undercount (ลูกค้าได้ใช้
 * เกินสิทธิ์ฟรี) และ double-spend (เราจ่าย OpenAI เกินโดยไม่ได้นับ) กระทบเงิน
 * จริงทั้งคู่ — เทสต์นี้พิสูจน์กลไก reserve/refund ตรงๆ ด้วย request จริง
 * ยิงพร้อมกันผ่าน Postgres จริง (ไม่ mock version check) ไม่ยิง OpenAI จริง
 * เพราะทดสอบแค่ชั้น reserve/refund ไม่ใช่ตัววิเคราะห์
 *
 * ใช้ RESULT_KEY (คีย์เดียวกับที่ analyze.ts ใช้จริง) ผ่าน reserveQuotaSlot/
 * refundQuotaSlot ที่ export ออกมาให้เทสต์เรียกตรงได้ — ไม่ใช่ mock ของกลไก
 * จริง เป็นกลไกจริงตัวเดียวกับที่ production ใช้
 */
const RESULT_KEY = "ai-insight-result";

test("reserveQuotaSlot: N คำขอชนกันพร้อมกัน ต้องผ่านตามโควตาเป๊ะ ไม่ undercount ไม่ overcount", async () => {
  await withOrgPair(async ({ orgA }) => {
    const limit = 10;
    const attempts = 25; // เกินโควตาเยอะพอที่จะบังคับให้ CAS loop เจอ conflict จริง ไม่ใช่แค่ทฤษฎี

    const results = await Promise.all(
      Array.from({ length: attempts }, () => reserveQuotaSlot(orgA, limit))
    );

    const succeeded = results.filter((r) => r.ok);
    const quotaRejected = results.filter((r) => !r.ok && r.reason === "quota");
    const busy = results.filter((r) => !r.ok && r.reason === "busy");

    // หัวใจของเทสต์นี้: ต้องผ่านเป๊ะเท่าโควตา ไม่ใช่ "ประมาณๆ" — undercount
    // (ผ่านน้อยกว่า limit ทั้งที่ควรผ่านได้) แปลว่าลูกค้าถูกปฏิเสธทั้งที่ยังไม่
    // เกินสิทธิ์ overcount แปลว่าเราจ่าย OpenAI เกินสิทธิ์แพ็กเกจที่ขายจริง
    assert.equal(succeeded.length, limit, `ต้องมีคำขอผ่านเท่ากับโควตาเป๊ะ (${limit}) ไม่ใช่ ${succeeded.length}`);
    assert.equal(succeeded.length + quotaRejected.length + busy.length, attempts);

    // ยอดที่เก็บจริงใน DB ต้องตรงกับจำนวนที่ reserve บอกว่าผ่านเป๊ะ — เช็คแหล่ง
    // ความจริง ไม่ใช่แค่เชื่อ return value ของฟังก์ชัน
    const { data } = await readStore<{ usage: { count: number } }>(orgA, RESULT_KEY);
    assert.equal(data?.usage.count, limit, "count ที่เก็บจริงใน DB ต้องตรงกับโควตาเป๊ะ");
  });
});

test("refundQuotaSlot: refund ระหว่างที่มีคำขออื่นจองแทรกเข้ามา ต้อง decrement ค่าปัจจุบัน ไม่ใช่เขียนทับด้วยสแนปช็อตเก่า", async () => {
  await withOrgPair(async ({ orgA }) => {
    const limit = 5;

    // จองไว้ก่อน 1 ครั้ง (จำลอง request ที่จะ refund เพราะ OpenAI ต่อไม่ติด)
    const first = await reserveQuotaSlot(orgA, limit);
    assert.ok(first.ok);
    if (!first.ok) return;

    // ระหว่างนั้นมี request อื่นจองสำเร็จเพิ่มอีก 2 (เช่น ผู้ใช้อีกคนกดพร้อมกัน)
    const second = await reserveQuotaSlot(orgA, limit);
    const third = await reserveQuotaSlot(orgA, limit);
    assert.ok(second.ok && third.ok);

    // ยอดตอนนี้ต้องเป็น 3 (จองสำเร็จไปแล้ว 3 ครั้ง) ก่อน refund ของ "first"
    const beforeRefund = await readStore<{ usage: { count: number } }>(orgA, RESULT_KEY);
    assert.equal(beforeRefund.data?.usage.count, 3);

    // refund การจองแรก — ต้องลบ 1 จากยอด "ปัจจุบัน" (3) เหลือ 2 ไม่ใช่เขียนทับ
    // กลับไปเป็นค่าตอนจอง (0) ซึ่งจะลบ reservation ของ second/third ทิ้งไปด้วย
    await refundQuotaSlot(orgA, first.reservedMonth);

    const afterRefund = await readStore<{ usage: { count: number } }>(orgA, RESULT_KEY);
    assert.equal(
      afterRefund.data?.usage.count,
      2,
      "refund ต้อง decrement จากยอดปัจจุบัน (3→2) ไม่ใช่เขียนทับด้วยยอดตอนจอง (0)"
    );
  });
});

test("reserveQuotaSlot: เต็มโควตาแล้วต้องปฏิเสธ ไม่ใช่ปล่อยผ่านเงียบๆ", async () => {
  await withOrgPair(async ({ orgA }) => {
    const limit = 2;
    const r1 = await reserveQuotaSlot(orgA, limit);
    const r2 = await reserveQuotaSlot(orgA, limit);
    const r3 = await reserveQuotaSlot(orgA, limit);
    assert.ok(r1.ok && r2.ok);
    assert.deepEqual(r3, { ok: false, reason: "quota" });
  });
});
