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
}: {
  topicId: string;
  topicName: string;
  file: { url?: string; dataUrl?: string; name: string; mime?: string; size?: number };
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
        "shrink-0 flex items-center justify-center h-5 w-5 rounded-full transition-colors",
        state === "done" ? "bg-[var(--brand-green)] text-[var(--ink)]" : "bg-black/60 text-white/80 hover:text-white disabled:opacity-70"
      )}
      aria-label={state === "done" ? `เพิ่ม ${file.name} เข้าเอกสารของห้องนี้แล้ว` : `เพิ่ม ${file.name} เข้าเอกสารของห้องนี้`}
      title={state === "done" ? "อยู่ในเอกสารของห้องนี้แล้ว" : "เพิ่มเข้าเอกสารของห้องนี้ (ไม่ต้องอัปโหลดใหม่)"}
    >
      {state === "done" ? <Check className="h-3 w-3" /> : <FolderInput className="h-3 w-3" />}
    </button>
  );
}
