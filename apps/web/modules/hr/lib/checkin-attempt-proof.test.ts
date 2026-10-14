import { beforeAll, describe, expect, it, vi } from "vitest";
import { signCheckinAttempt, verifyCheckinAttempt } from "@/modules/hr/lib/checkin-attempt-proof";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

const attempt = { userId: "u1", intent: "CLOCK_IN" as const, latitude: 13.7, longitude: 100.5, accuracyM: 18, reason: "GPS ไม่ตรงสถานที่ทำงาน" };

describe("checkin attempt proof", () => {
  it("round-trips with the server time stamped in", () => {
    const proof = verifyCheckinAttempt(signCheckinAttempt(attempt), "u1");
    expect(proof).toMatchObject(attempt);
    expect(Date.now() - new Date(proof!.at).getTime()).toBeLessThan(5000);
  });

  it("rejects an edited time or location, and someone else's proof", () => {
    const token = signCheckinAttempt(attempt);
    const [body, mac] = token.split(".");
    const edited = JSON.parse(Buffer.from(body!, "base64url").toString());
    edited.at = "2026-10-14T00:30:00.000Z";
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${mac}`;
    expect(verifyCheckinAttempt(forged, "u1")).toBeNull();
    expect(verifyCheckinAttempt(token, "u2")).toBeNull();
  });

  it("rejects a proof older than 3 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T08:00:00Z"));
    const token = signCheckinAttempt(attempt);
    vi.setSystemTime(new Date("2026-10-05T08:00:00Z"));
    expect(verifyCheckinAttempt(token, "u1")).toBeNull();
    vi.useRealTimers();
  });
});
