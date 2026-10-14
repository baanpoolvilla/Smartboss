import { describe, expect, it } from "vitest";
import { parsePublicHolidays, planCompanySync } from "@/modules/hr/lib/public-holidays";

const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20270101",
  "DTEND;VALUE=DATE:20270102",
  "SUMMARY:วันขึ้นปีใหม่",
  "DESCRIPTION:วันหยุดนักขัตฤกษ์",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20270214",
  "DTEND;VALUE=DATE:20270215",
  "SUMMARY:วันวาเลนไทน์",
  "DESCRIPTION:วันสำคัญ\\nหากต้องการซ่อนวันสำคัญ ให้ไปที่การตั้งค่า Google ปฏิท",
  " ิน",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20271210",
  "DTEND;VALUE=DATE:20271211",
  "SUMMARY:​วันรัฐธรรมนูญ",
  "DESCRIPTION:วันหยุดนักขัตฤกษ์",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20270413",
  "DTEND;VALUE=DATE:20270416",
  "SUMMARY:วันสงกรานต์",
  "DESCRIPTION:วันหยุดนักขัตฤกษ์",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parsePublicHolidays", () => {
  it("keeps only public holidays, splits multi-day events and strips zero-width characters", () => {
    expect(parsePublicHolidays(ics)).toEqual([
      { date: "2027-01-01", name: "วันขึ้นปีใหม่" },
      { date: "2027-04-13", name: "วันสงกรานต์" },
      { date: "2027-04-14", name: "วันสงกรานต์" },
      { date: "2027-04-15", name: "วันสงกรานต์" },
      { date: "2027-12-10", name: "วันรัฐธรรมนูญ" },
    ]);
  });
});

describe("planCompanySync", () => {
  const google = [
    { date: "2026-10-13", name: "past" },
    { date: "2026-12-05", name: "วันพ่อ" },
    { date: "2026-12-07", name: "ชดเชย" },
    { date: "2027-01-01", name: "ปีใหม่" },
    { date: "2028-01-01", name: "too far" },
  ];

  it("adds future dates HR doesn't have yet, up to the end of next year", () => {
    const plan = planCompanySync(google, new Set(["2026-12-05"]), undefined, "2026-10-14");
    expect(plan.insert.map((h) => h.date)).toEqual(["2026-12-07", "2027-01-01"]);
    expect(plan.remove).toEqual([]);
    expect(plan.state.added).toEqual(["2026-12-07", "2027-01-01"]);
  });

  it("does not bring back a date HR deleted", () => {
    const previous = { seen: ["2026-12-05", "2026-12-07", "2027-01-01"], added: ["2026-12-07", "2027-01-01"] };
    const plan = planCompanySync(google, new Set(["2026-12-05", "2027-01-01"]), previous, "2026-10-14");
    expect(plan.insert).toEqual([]);
  });

  it("removes a date it added once Google drops it, but never one HR entered", () => {
    const previous = { seen: ["2026-12-05", "2026-12-08"], added: ["2026-12-08"] };
    const plan = planCompanySync(
      google.filter((h) => h.date !== "2026-12-05"),
      new Set(["2026-12-05", "2026-12-08"]),
      previous,
      "2026-10-14"
    );
    expect(plan.remove).toEqual(["2026-12-08"]);
    expect(plan.state.added).not.toContain("2026-12-08");
  });
});
