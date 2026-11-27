/**
 * Log การบันทึกระบบบุคคล — อ่านจากฐานข้อมูลจริงในเครื่อง (ทุกแหล่งรวมกัน) · อ่านอย่างเดียว ไม่เขียนอะไร
 * รันเฉพาะเมื่อสั่ง: set -a; . ../../.env; set +a; HR_LOG_DB_TEST=1 npx vitest run modules/hr/lib/change-log.db.test.ts
 */
import { describe, expect, it } from "vitest";

const RUN = process.env.HR_LOG_DB_TEST === "1";
const ORG = "a22927e8-2ff9-4e7a-b271-0cbb2eba56b6";

describe.skipIf(!RUN)("Log การบันทึกระบบบุคคล (DB จริง)", () => {
  it("ทุกแหล่งอ่านได้ เรียงใหม่→เก่า ไม่มีรหัสอังกฤษหลุด", async () => {
    const { loadChangeLog, filterChangeLog } = await import("./change-log");
    const to = new Date(Date.now() + 86_400_000);
    const from = new Date(Date.now() - 365 * 86_400_000);
    const { entries, failed } = await loadChangeLog(ORG, { from, to, includeCheckins: false });
    expect(failed).toEqual([]);
    expect(entries.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1]!.at >= entries[i]!.at).toBe(true);
    expect(entries.some((e) => e.category === "checkin")).toBe(false);
    const raw = entries.filter((e) => /^[a-z]+(\.[a-z_-]+)+$/.test(e.text));
    expect(raw.map((e) => e.text)).toEqual([]);
    const bySource = entries.reduce<Record<string, number>>((m, e) => ((m[e.id.split(":")[0]!] = (m[e.id.split(":")[0]!] ?? 0) + 1), m), {});
    const byCat = entries.reduce<Record<string, number>>((m, e) => ((m[e.category] = (m[e.category] ?? 0) + 1), m), {});
    console.log("sources", bySource, "categories", byCat, "with target", entries.filter((e) => e.target).length, "/", entries.length);
    for (const e of entries.slice(0, 12)) console.log(e.at.slice(0, 16), "|", e.actor, "|", e.category, "|", e.text, "|", e.target?.name ?? "—", "|", JSON.stringify(e.details).slice(0, 160));
    const pay = filterChangeLog(entries, { category: "pay", actor: "", target: "", q: "" });
    expect(pay.every((e) => e.category === "pay")).toBe(true);
    const withCheckins = await loadChangeLog(ORG, { from, to, includeCheckins: true });
    expect(withCheckins.entries.length).toBeGreaterThanOrEqual(entries.length);
  }, 60_000);

  it("เปลี่ยนวิธีคิดค่าคอม → ขึ้นใน log หมวดค่าคอม เดิม→ใหม่ (แล้วคืนค่าเดิม)", async () => {
    const { prisma } = await import("@smartboss/database");
    const { saveCommissionMethod } = await import("./commission-data");
    const { loadChangeLog } = await import("./change-log");
    const ceo = await prisma.user.findFirstOrThrow({ where: { orgId: ORG, roles: { some: { role: { code: "CEO" } } } }, select: { id: true } });
    const before = await prisma.commissionSetting.findUnique({ where: { orgId: ORG }, select: { method: true } });
    const was = before?.method ?? "pool";
    const other = was === "percent" ? "fixed" : "percent";
    const t0 = new Date(Date.now() - 1000);
    try {
      await saveCommissionMethod({ orgId: ORG, userId: ceo.id, method: other });
      const { entries } = await loadChangeLog(ORG, { from: t0, to: new Date(Date.now() + 60_000), includeCheckins: false });
      const hit = entries.find((e) => e.category === "commission" && e.text === "เปลี่ยนวิธีคิดค่าคอม");
      expect(hit?.details[0]?.label).toBe("วิธีคิดค่าคอม");
      expect(hit?.details[0]?.after).toBe(other === "percent" ? "% ของเงินเดือนตามเกรด" : "บาทต่อคนตามเกรด");
    } finally {
      await saveCommissionMethod({ orgId: ORG, userId: ceo.id, method: was });
    }
  }, 60_000);
});
