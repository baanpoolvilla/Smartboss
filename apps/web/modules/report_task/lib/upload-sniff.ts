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
    // .docx (and the rest of OOXML — xlsx/pptx) is itself a zip archive, same
    // leading signature as a plain .zip — the only way to tell them apart is
    // to look for the part name each app actually stores inside it.
    if (containsAscii(b, "word/document.xml")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (containsAscii(b, "xl/workbook.xml")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (containsAscii(b, "ppt/presentation.xml")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return "application/zip";
  }
  // Legacy .doc/.xls/.ppt all share the one OLE compound-file container, so
  // the signature alone can't tell them apart — the stream name each app
  // stores in the container's directory can. Those names are UTF-16LE, hence
  // containsUtf16 rather than the ASCII scan the OOXML branch above uses.
  // Falls back to .doc (what this returned for every OLE file before Excel
  // and PowerPoint were allowed through) when no known stream is found.
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (containsUtf16(b, "Workbook") || containsUtf16(b, "Book")) return "application/vnd.ms-excel";
    if (containsUtf16(b, "PowerPoint Document")) return "application/vnd.ms-powerpoint";
    return "application/msword";
  }
  if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  // MP4/mov-family: a size (4 bytes) then "ftyp" at offset 4 — the size
  // itself varies, so only the "ftyp" marker is checked.
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) return "video/mp4";

  // Neither .txt nor .csv has a signature to check — both fall back to
  // "decodes as UTF-8 and carries no embedded HTML/script", and the claimed
  // type decides which of the two it's stored as. A .csv is only ever plain
  // text, so it needs no separate structural check of its own.
  if ((claimedType === "text/plain" || claimedType === "text/csv") && looksLikePlainText(b)) return claimedType;

  return null;
}

/** Whether `needle` appears in `bytes` encoded as UTF-16LE — how an OLE
 * compound file (legacy .doc/.xls/.ppt) writes the stream names in its
 * directory, so an ASCII scan never finds them. */
function containsUtf16(bytes: Uint8Array, needle: string): boolean {
  const target: number[] = [];
  for (const char of needle) {
    const code = char.charCodeAt(0);
    target.push(code & 0xff, code >> 8);
  }
  outer: for (let i = 0; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Whether `needle` (plain ASCII) appears anywhere in `bytes` — used to spot
 * a filename stored inside a zip container without unzipping it. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

function looksLikePlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  } catch {
    return false;
  }

  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return false; // binary control bytes
  if (/<\s*(script|iframe|object|embed)\b/i.test(text)) return false; // renamed-.html guard
  return true;
}
