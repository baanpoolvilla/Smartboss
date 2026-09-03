import { FileArchive, FileSpreadsheet, FileText, FileType, Presentation } from "lucide-react";
import { formatFileSize } from "@/modules/company-files/lib/file-meta";
import { attachmentTypeLabel, fileKindOf } from "@/modules/report_task/lib/report-attachment-kind";
import { cn } from "@/modules/report_task/lib/utils";

/** One icon per document family — a pdf and a spreadsheet should be tellable
 * apart at thumbnail size without reading the filename. Returns the rendered
 * element rather than the component: assigning a component to a local during
 * render and instantiating it there remounts it on every render (and the
 * React compiler's static-components rule rejects it outright). */
function iconFor(mime: string) {
  const className = "h-4 w-4";
  switch (fileKindOf(mime)) {
    case "pdf":
      return <FileType className={className} />;
    case "excel":
      return <FileSpreadsheet className={className} />;
    case "powerpoint":
      return <Presentation className={className} />;
    case "archive":
      return <FileArchive className={className} />;
    default:
      return <FileText className={className} />;
  }
}

const toneFor: Record<string, string> = {
  pdf: "text-[var(--chart-red)] bg-[var(--chart-red)]/10",
  word: "text-[var(--chart-blue)] bg-[var(--chart-blue)]/10",
  excel: "text-[var(--chart-green)] bg-[var(--chart-green)]/10",
  powerpoint: "text-[var(--chart-orange)] bg-[var(--chart-orange)]/10",
  archive: "text-[var(--chart-amber)] bg-[var(--chart-amber)]/10",
};

/**
 * A pdf/word/excel attachment rendered as a file card instead of a picture —
 * `<img src="…file.pdf">` only ever produced a broken-image icon, which is
 * what a document attached to a post used to look like everywhere it appeared.
 *
 * Deliberately not a link: every place this renders sits inside a button that
 * already handles the click (open the lightbox, open the post), and nesting an
 * `<a>` in a `<button>` is invalid. Opening the real file is the lightbox's
 * job — see report-image-lightbox.tsx.
 */
/**
 * How much of the card fits where it's rendered. A photo thumbnail can be
 * scaled to any square and still read; a file card can't — its content is
 * text, so below a certain size the name and type have to drop rather than
 * spill out of a 48px preview square under `overflow-hidden`.
 *
 * - `full` (default): icon + filename + type · size — post grids, the
 *   "ไฟล์" tab, an Openchat message. Needs ~96px of width.
 * - `compact`: icon + type ("PDF") — the composer's 64px preview squares,
 *   where the filename has nowhere to go but the tooltip.
 * - `icon`: the type badge alone — 44-48px squares (reply previews, the
 *   lightbox filmstrip), and rows that print the name beside it themselves.
 */
export type FileChipVariant = "full" | "compact" | "icon";

export function ReportFileChip({
  media,
  className,
  variant = "full",
}: {
  media: { name: string; mime?: string; size?: number };
  className?: string;
  variant?: FileChipVariant;
}) {
  const mime = media.mime ?? "";
  const tone = toneFor[fileKindOf(mime)] ?? "text-[var(--ink-soft)] bg-[var(--bg-soft)]";
  return (
    <span
      className={cn(
        "flex min-w-0 flex-col items-center justify-center overflow-hidden text-center",
        variant === "full" && "gap-1.5 rounded-lg border border-[var(--line)] bg-white p-2",
        variant === "compact" && "gap-1 p-1",
        className
      )}
      // The one place the full filename is always available, whichever
      // variant ends up rendering.
      title={media.name}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg",
          variant === "compact" ? "h-7 w-7" : "h-8 w-8",
          tone
        )}
      >
        {iconFor(mime)}
      </span>
      {variant === "compact" && (
        <span className="block w-full truncate text-[10px] font-medium leading-tight text-[var(--ink-soft)]">
          {attachmentTypeLabel(media.mime)}
        </span>
      )}
      {variant === "full" && (
        <span className="w-full min-w-0">
          <span className="block truncate text-[11px] font-medium leading-tight">{media.name}</span>
          <span className="block truncate text-[10px] text-[var(--ink-soft)]">
            {attachmentTypeLabel(media.mime)}
            {media.size ? ` · ${formatFileSize(media.size)}` : ""}
          </span>
        </span>
      )}
    </span>
  );
}
