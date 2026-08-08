import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl } from "@/modules/report_task/lib/ssrf-guard";

describe("assertPublicHttpsUrl", () => {
  it("rejects non-https URLs", async () => {
    await expect(assertPublicHttpsUrl("http://example.com/cal.ics")).rejects.toThrow();
  });

  it("rejects a loopback IP", async () => {
    await expect(assertPublicHttpsUrl("https://127.0.0.1/cal.ics")).rejects.toThrow();
  });

  it("rejects the cloud metadata link-local address", async () => {
    await expect(assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow();
  });

  it("rejects RFC1918 private ranges", async () => {
    await expect(assertPublicHttpsUrl("https://10.0.0.5/cal.ics")).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://192.168.1.1/cal.ics")).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://172.16.0.1/cal.ics")).rejects.toThrow();
  });

  it("rejects IPv6 loopback and unique-local addresses", async () => {
    await expect(assertPublicHttpsUrl("https://[::1]/cal.ics")).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://[fd00::1]/cal.ics")).rejects.toThrow();
  });

  it("accepts a public IPv4 address literal", async () => {
    await expect(assertPublicHttpsUrl("https://8.8.8.8/cal.ics")).resolves.toBeUndefined();
  });
});
