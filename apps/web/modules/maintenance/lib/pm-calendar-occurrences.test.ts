import { describe, expect, it } from "vitest";
import { occurrencesInMonth, plannedRounds, type PmCalendarSource } from "./pm-calendar";

const base: PmCalendarSource = {
  id: "pm1",
  nextDueInput: "2026-11-30",
  awaitingSchedule: false,
  frequency: "weekly",
  roundsPerYear: null,
  anchorInput: "2026-11-02",
  mode: "continuous",
  history: [],
};
const NOV = { year: 2026, month: 10 };
const mondaysNov = ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"];
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe("ปฏิทิน PM — ทุกรอบของเดือน (ผู้ใช้ 24/11/2569)", () => {
  it("ทุกวันจันทร์: รอบอาทิตย์นี้เปิดใบแล้ว (nextDue เลื่อนไปจันทร์หน้า) ยังขึ้นครบทุกจันทร์", () => {
    const pm: PmCalendarSource = {
      ...base,
      history: [
        { iso: "2026-11-02", kind: "done", workOrderId: "w1" },
        { iso: "2026-11-09", kind: "done", workOrderId: "w2" },
        { iso: "2026-11-16", kind: "done", workOrderId: "w3" },
        { iso: "2026-11-23", kind: "open", workOrderId: "w4" },
      ],
    };
    const map = occurrencesInMonth([pm], NOV);
    expect([...map.keys()].sort()).toEqual(mondaysNov);
    expect(map.get("2026-11-23")![0]!.kind).toBe("open");
    expect(map.get("2026-11-02")![0]!.kind).toBe("done");
    expect(map.get("2026-11-30")![0]!.kind).toBe("planned");
  });

  it("เปลี่ยนจากรายเดือนเป็นรายสัปดาห์ (วันตั้งต้นเดิมเป็นวันพฤหัส) รอบที่จะถึงยังตกวันจันทร์ทุกอาทิตย์", () => {
    const pm: PmCalendarSource = { ...base, nextDueInput: "2026-11-02", anchorInput: "2026-10-15" };
    const rounds = plannedRounds(pm, "2026-12-31");
    expect(rounds.length).toBe(9);
    expect(rounds.every((d) => dow(d) === 1)).toBe(true);
  });

  it("ไม่มีวันของเดือนก่อน/ถัดไปปน และรอบเดียวกันไม่ซ้ำ", () => {
    const pm: PmCalendarSource = { ...base, nextDueInput: "2026-10-26", history: [{ iso: "2026-10-26", kind: "open", workOrderId: "w0" }] };
    const map = occurrencesInMonth([pm], NOV);
    expect([...map.keys()].every((k) => k.startsWith("2026-11-"))).toBe(true);
    expect([...map.values()].every((l) => l.length === 1)).toBe(true);
    expect([...map.keys()].sort()).toEqual(mondaysNov);
  });

  it("รอนัดวัน/จำกัดจำนวนครั้ง ไม่เดารอบล่วงหน้า", () => {
    expect(plannedRounds({ ...base, awaitingSchedule: true }, "2026-12-31")).toEqual([]);
    expect(plannedRounds({ ...base, mode: "limitedCount", nextDueInput: "2026-11-09" }, "2026-12-31")).toEqual(["2026-11-09"]);
  });

  it("รายเดือนวันที่ 31 ไม่หดตามเดือนสั้น", () => {
    const pm: PmCalendarSource = { ...base, frequency: "monthly", nextDueInput: "2027-01-31", anchorInput: "2027-01-31" };
    expect(plannedRounds(pm, "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });
});
