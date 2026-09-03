"use client";

import { useState } from "react";
import { toast } from "sonner";
import { addFileToRoomFolder } from "@/modules/company-files/data/files";
import { cn } from "@/modules/report_task/lib/utils";
import { FolderInput, Check } from "lucide-react";

/**
 * Overlay button (top-right of a thumbnail in the "ไฟล์" tab, mirrors
 * AlbumPickerButton's own top-left bookmark icon) that copies one already-
 * uploaded attachment straight into the room's real document library
 * ("เอกสารของห้องนี้" — company-files, not the report-feed-only "อัลบั้ม")
 * without re-picking the file from disk. Previously the only way in was the
 * "อัปโหลดเอกสาร" button, which meant downloading the photo first just to
 * upload it right back ("ตอนนี้ต้องกดอัพโหลด อยากให้กดจากไฟล์ในห้องได้เลย").
 *
 * No new bytes get written — `addFileToRoomFolder` just points a new
 * CompanyFile row at the same storage key the report already uploaded to,
 * so this can't push anyone over a storage quota. Who can see the result is
 * unchanged too: `เอกสารของห้องนี้` was already gated server-side to current
 * room members only (see room-access-server.ts), same as everything else
 * here — this button doesn't touch that.
 */
export function SaveToDocumentsButton({
  topicId,
  topicName,
  file,
  variant = "overlay",
}: {
  topicId: string;
  topicName: string;
  file: { url?: string; dataUrl?: string; name: string; mime?: string; size?: number };
  /** "overlay" is the original: a 20px dark circle sitting on the corner of a
   * photo thumbnail, where anything bigger would cover the photo. "row" is
   * for the "เอกสาร" list, where it's a standalone control in a row with
   * nothing to cover — 20px there is too small to hit on a phone. */
  variant?: "overlay" | "row";
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (state !== "idle" || !file.url) return;
    setState("busy");
    try {
      await addFileToRoomFolder(topicId, topicName, {
        url: file.url,
        name: file.name,
        // The jpeg fallback is only for attachments from before `mime` was
        // recorded at all — back then every attachment really was a photo.
        // A pdf/xlsx must never take it: the library shows the wrong type,
        // offers an image preview that can't render, and hands the browser a
        // Content-Type that doesn't match the bytes.
        mimeType: file.mime ?? "image/jpeg",
        size: file.size ?? 0,
      });
      setState("done");
      toast.success(`เพิ่ม "${file.name}" เข้าเอกสารของห้องนี้แล้ว`);
    } catch (err) {
      setState("idle");
      toast.error(err instanceof Error ? err.message : "เพิ่มเข้าเอกสารไม่สำเร็จ");
    }
  }

  // A legacy image with no storage url (old inline dataUrl attachment) has
  // nothing for company-files to point a storageKey at — hide instead of
  // offering a button that can only fail.
  if (!file.url) return null;

  return (
    <button
      onClick={handleClick}
      disabled={state !== "idle"}
      className={cn(
        "shrink-0 flex items-center justify-center rounded-full transition-colors",
        variant === "overlay"
          ? cn(
              "h-5 w-5",
              state === "done" ? "bg-[var(--brand-green)] text-[var(--ink)]" : "bg-black/60 text-white/80 hover:text-white disabled:opacity-70"
            )
          : cn(
              "h-8 w-8 border",
              state === "done"
                ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] disabled:opacity-70"
            )
      )}
      aria-label={state === "done" ? `เพิ่ม ${file.name} เข้าเอกสารของห้องนี้แล้ว` : `เพิ่ม ${file.name} เข้าเอกสารของห้องนี้`}
      title={state === "done" ? "อยู่ในเอกสารของห้องนี้แล้ว" : "เพิ่มเข้าเอกสารของห้องนี้ (ไม่ต้องอัปโหลดใหม่)"}
    >
      {state === "done" ? (
        <Check className={variant === "overlay" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : (
        <FolderInput className={variant === "overlay" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      )}
    </button>
  );
}
