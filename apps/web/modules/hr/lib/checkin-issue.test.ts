import { describe, expect, it } from "vitest";
import { guessCheckinProblem } from "@/modules/hr/lib/checkin-issue";

// ข้อความจริงจาก api/m/checkin gpsGate
describe("guessCheckinProblem", () => {
  it("picks the problem from the clock screen's last message", () => {
    expect(guessCheckinProblem("ไม่ได้รับตำแหน่ง GPS — เปิด Location ในเครื่องและอนุญาตตำแหน่งให้แอป แล้วกดใหม่")).toBe("gps_denied");
    expect(guessCheckinProblem("GPS ยังไม่แม่นพอ (คลาด ±120 ม. ต้องไม่เกิน 50 ม.)")).toBe("gps_inaccurate");
    expect(guessCheckinProblem("อยู่นอกพื้นที่ทำงาน (ห่างจากจุดที่ตั้งไว้ 340 ม.)")).toBe("outside_area");
    expect(guessCheckinProblem("ส่งข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง")).toBe("button_error");
    expect(guessCheckinProblem(null)).toBe("other");
  });
});
