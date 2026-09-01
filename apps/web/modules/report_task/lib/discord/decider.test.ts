import { describe, expect, it } from "vitest";
import { decide, toThaiLocal, type ChannelRule } from "@/modules/report_task/lib/discord/decider";

const rule: ChannelRule = {
  topicId: "topic-daily",
  minImages: 1,
  rounds: [
    { id: "morning", label: "เช้า", time: "09:00", minImages: 2 },
    { id: "evening", label: "เย็น", time: "17:00", minImages: 0 },
  ],
};

describe("toThaiLocal", () => {
  it("แปลง UTC -> เวลาไทย (+7) ถูกต้อง", () => {
    // 02:05 UTC = 09:05 ไทย
    const r = toThaiLocal("2026-08-31T02:05:00.000Z");
    expect(r.date).toBe("2026-08-31");
    expect(r.minutes).toBe(9 * 60 + 5);
  });
  it("ข้ามวันเมื่อ +7 ดันข้ามเที่ยงคืน", () => {
    // 18:30 UTC 31 ส.ค. = 01:30 ไทย 1 ก.ย.
    const r = toThaiLocal("2026-08-31T18:30:00.000Z");
    expect(r.date).toBe("2026-09-01");
    expect(r.minutes).toBe(1 * 60 + 30);
  });
});

describe("decide", () => {
  it("ยกเว้นเมื่อไม่ต้องส่ง (ลา/หยุด/ไม่มีกะ)", () => {
    const d = decide({ postedAtIso: "2026-08-31T02:00:00Z", imageCount: 0, rule, mustReport: false });
    expect(d.status).toBe("exempt");
    expect(d.shouldDock).toBe(false);
  });

  it("ตรงเวลา: ก่อน cutoff เช้า + รูปครบ", () => {
    // 01:30 UTC = 08:30 ไทย, ก่อน 09:00, รูป 2 ใบ (ครบ)
    const d = decide({ postedAtIso: "2026-08-31T01:30:00Z", imageCount: 2, rule, mustReport: true });
    expect(d.roundId).toBe("morning");
    expect(d.status).toBe("on-time");
    expect(d.shouldDock).toBe(false);
  });

  it("รูปไม่ครบ: ก่อน cutoff แต่รูปน้อยกว่า minImages ของรอบ", () => {
    // 08:30 ไทย, รอบเช้าต้องการ 2 ใบ แต่ส่ง 1
    const d = decide({ postedAtIso: "2026-08-31T01:30:00Z", imageCount: 1, rule, mustReport: true });
    expect(d.status).toBe("image-incomplete");
    expect(d.shouldDock).toBe(false);
  });

  it("สาย: เลย cutoff รอบสุดท้าย", () => {
    // 12:00 UTC = 19:00 ไทย, เลย 17:00 -> สายของรอบเย็น
    const d = decide({ postedAtIso: "2026-08-31T12:00:00Z", imageCount: 0, rule, mustReport: true });
    expect(d.roundId).toBe("evening");
    expect(d.status).toBe("late");
    expect(d.shouldDock).toBe(true);
  });

  it("เข้ารอบเย็น (ตรงเวลา) เมื่ออยู่ระหว่างเช้ากับเย็น", () => {
    // 08:00 UTC = 15:00 ไทย, หลัง 09:00 ก่อน 17:00 -> รอบเย็น ตรงเวลา (เย็น minImages=0)
    const d = decide({ postedAtIso: "2026-08-31T08:00:00Z", imageCount: 0, rule, mustReport: true });
    expect(d.roundId).toBe("evening");
    expect(d.status).toBe("on-time");
  });
});
