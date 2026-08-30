import { sniffMime as sniffBaseMime } from "@/modules/report_task/lib/upload-sniff";

const OFFICE_OOXML_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const OFFICE_LEGACY_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

/**
 * report_task's own `sniffMime` only knows the 9 types that module ever
 * needed — it reads a modern .docx/.xlsx/.pptx as plain `application/zip`
 * (correct: they really are zip containers) and has no signature for the
 * legacy OLE-based .doc/.xls/.ppt at all, since neither ever came up there.
 * This module's whole point is being a general document store, so both need
 * to actually work.
 *
 * Real per-format detection would mean unzipping to check for `word/`/`xl/`/
 * `ppt/` internal paths (OOXML) or parsing the OLE compound-file directory
 * (legacy) — more than this needs today. Instead: trust the *shape* (zip
 * container / OLE container) plus the client's claimed MIME being a plausible
 * member of that shape's family. This still blocks the actual attack this
 * exists to prevent (renaming an .exe or .html to .docx has neither
 * signature), just not the finer-grained "which zip is it really" question.
 */
export function sniffCompanyFileMime(bytes: Uint8Array, claimedType: string): string | null {
  const base = sniffBaseMime(bytes, claimedType);
  if (base) {
    // Base sniffer says "zip" (true of every OOXML file) — if the client
    // claimed one of the three OOXML office types, accept that claim rather
    // than downgrading a real .docx to a rejected upload.
    if (base === "application/zip" && OFFICE_OOXML_TYPES.has(claimedType)) return claimedType;
    return base;
  }
  if (startsWithOle(bytes) && OFFICE_LEGACY_TYPES.has(claimedType)) return claimedType;
  return null;
}

function startsWithOle(bytes: Uint8Array): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return sig.every((byte, i) => bytes[i] === byte);
}
