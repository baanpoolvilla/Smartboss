/**
 * Magic-byte sniffing for uploads — never trust `file.type` from the client,
 * it's just whatever the browser guessed (or whatever an attacker set) off
 * the filename. Checks the first few bytes against each allowed type's real
 * on-disk signature instead. `text/plain` has no reliable signature, so it
 * falls back to "decodes as UTF-8 and has no embedded HTML/script tags" —
 * good enough to block someone renaming an .html file to .txt to get it
 * served back verbatim, not a full sanitizer.
 */
export function sniffMime(bytes: Uint8Array, claimedType: string): string | null {
  const b = bytes;
  const startsWith = (sig: number[], offset = 0) => sig.every((byte, i) => b[offset + i] === byte);

  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (startsWith([0x50, 0x4b, 0x03, 0x04]) || startsWith([0x50, 0x4b, 0x05, 0x06]) || startsWith([0x50, 0x4b, 0x07, 0x08])) {
    return "application/zip";
  }
  if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  // MP4/mov-family: a size (4 bytes) then "ftyp" at offset 4 — the size
  // itself varies, so only the "ftyp" marker is checked.
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) return "video/mp4";

  if (claimedType === "text/plain" && looksLikePlainText(b)) return "text/plain";

  return null;
}

function looksLikePlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  } catch {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return false; // binary control bytes
  if (/<\s*(script|iframe|object|embed)\b/i.test(text)) return false; // renamed-.html guard
  return true;
}
