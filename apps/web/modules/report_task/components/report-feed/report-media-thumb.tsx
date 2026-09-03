import { Play } from "lucide-react";
import { ReportFileChip, type FileChipVariant } from "@/modules/report_task/components/report-feed/report-file-chip";
import { attachmentKind } from "@/modules/report_task/lib/report-attachment-kind";
import { cn } from "@/modules/report_task/lib/utils";

/** Shared thumbnail for one attached image, video or document — every
 * grid/preview spot (post cards, composer preview, replies, Openchat
 * messages, the ไฟล์ tab) used to just `<img src={...}>` unconditionally,
 * which renders a broken-image icon for a video row now that posts can carry
 * those. Renders a muted, controls-less `<video>` with a play badge instead —
 * actual playback happens in the lightbox (report-image-lightbox.tsx), same
 * as clicking any image thumbnail already opens it there.
 *
 * A pdf/word/excel attachment has no frame to show at all, so it renders as a
 * file card (ReportFileChip). Routing that decision through this one shared
 * component rather than each grid means every existing render site handles
 * documents the moment posts can carry them, with no per-site change. */
export function ReportMediaThumb({
  media,
  className,
  alt,
  fileChipVariant = "full",
}: {
  media: { url?: string; dataUrl?: string; mime?: string; name: string; size?: number };
  className?: string;
  alt?: string;
  /** How much of a document's file card fits in this spot — a photo scales
   * to any square, a card of text doesn't. Small preview squares (the
   * composer's 64px row, a reply's 48px row) pass "compact"/"icon"; see
   * FileChipVariant. Ignored for images and videos. */
  fileChipVariant?: FileChipVariant;
}) {
  const src = media.url ?? media.dataUrl;
  const kind = attachmentKind(media.mime);
  if (kind === "doc") {
    return <ReportFileChip media={media} variant={fileChipVariant} className={className} />;
  }
  if (kind === "video") {
    return (
      <span className={cn("relative block overflow-hidden", className)}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={src} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Play className="h-1/3 w-1/3 text-white drop-shadow" fill="white" />
        </span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt ?? media.name} className={className} />;
}
