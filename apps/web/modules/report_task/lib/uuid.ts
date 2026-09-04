/**
 * A v4 UUID that works outside a secure context and on older browsers.
 *
 * `crypto.randomUUID()` only exists in a secure context (HTTPS or
 * localhost) on Safari ≥15.4 / Chrome ≥92 / recent Android WebViews — call
 * it from plain `http://<lan-ip>` (a phone testing against a dev server, an
 * internal deploy without TLS yet), an older device, or some in-app
 * browsers, and it's `undefined` — accessing `.randomUUID` there doesn't
 * throw, but *calling* `undefined()` does, taking down whatever action
 * (create task/todo/post/checklist item, ...) triggered it with a blank
 * error. `crypto.getRandomValues` has no such restriction, so this falls
 * back to building a v4 UUID from that directly, and to `Math.random` only
 * if `crypto` itself is entirely unavailable.
 */
export function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual build below
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
