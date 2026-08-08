import { promises as dns } from "node:dns";
import net from "node:net";

/**
 * Blocks a URL from being fetched server-side if its host resolves to a
 * private/loopback/link-local/reserved address — a client that can make the
 * server fetch an arbitrary https:// URL (the ICS calendar link feature) can
 * otherwise probe the internal network or cloud metadata endpoints (SSRF).
 *
 * Known gap: this checks DNS at validation time, not at actual-fetch time, so
 * a malicious DNS server could still rebind the hostname to a private IP
 * between the check and the real request (TOCTOU). Closing that fully needs
 * a fetch client that connects to the specific IP it just validated, which
 * `node-ical`'s fetch doesn't expose — acceptable trade-off for now since it
 * still blocks every straightforward "point this at 127.0.0.1 / 169.254.169.254
 * / an internal hostname" attempt.
 */
export async function assertPublicHttpsUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("ต้องเป็นลิงก์ https://");
  }

  const hostname = url.hostname;
  const ipFamily = net.isIP(hostname);
  if (ipFamily) {
    if (isPrivateOrReserved(hostname, ipFamily)) {
      throw new Error("ไม่อนุญาตให้เชื่อมต่อที่อยู่ภายในเครือข่าย");
    }
    return;
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("แปลงชื่อโดเมนไม่สำเร็จ");
  }
  if (records.length === 0) {
    throw new Error("แปลงชื่อโดเมนไม่สำเร็จ");
  }
  for (const record of records) {
    if (isPrivateOrReserved(record.address, record.family)) {
      throw new Error("ไม่อนุญาตให้เชื่อมต่อที่อยู่ภายในเครือข่าย");
    }
  }
}

function isPrivateOrReserved(address: string, family: number): boolean {
  return family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  // เช็ค parts.length !== 4 ไปแล้วบรรทัดบน — ยืนยันชนิดให้ TS ตามทัน
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT (RFC6598)
  if (a >= 224) return true; // multicast/reserved/broadcast
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address — validate the embedded IPv4.
    return isPrivateIPv4(lower.slice("::ffff:".length));
  }
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  return false;
}
