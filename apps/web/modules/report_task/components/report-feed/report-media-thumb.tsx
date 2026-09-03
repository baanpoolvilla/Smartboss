import { Play } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/** Shared thumbnail for one attached image or video — every grid/preview
 * spot (post cards, composer preview, replies, Openchat messages, the ไฟล์
 * tab) used to just `<img src={...}>` unconditionally, which renders a
 * broken-image icon for a video row now that posts can carry those. Renders
 * a muted, controls-less `<video>` with a play badge instead — actual
 * playback happens in the lightbox (report-image-lightbox.tsx), same as
 * clicking any image thumbnail already opens it there. */
export function ReportMediaThumb({
  media,
  className,
  alt,
}: {
  media: { url?: string; dataUrl?: string; mime?: string; name: string };
  className?: string;
  alt?: string;
}) {
  const src = media.url ?? media.dataUrl;
  if (media.mime?.startsWith("video/")) {
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
