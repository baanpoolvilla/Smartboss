import Link from "next/link";
import { Card } from "@smartboss/ui/components/card";

export const inputClass =
  "flex h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export const selectClass = inputClass;

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-(--ink)">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-(--ink-soft)">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}

export function SectionCard({
  title,
  description,
  action,
  className = "",
  children,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-(--ink)">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-(--ink-soft)">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card className="p-10 text-center text-sm text-(--ink-soft)">
      {children}
    </Card>
  );
}

/** ป้ายสถานะสีอ่อน */
export function Pill({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}40` }}
    >
      {children}
    </span>
  );
}

/** การ์ดตัวเลขสรุปบนหน้าภาพรวม */
export function StatCard({
  label,
  value,
  hint,
  href,
  color = "#1B2537",
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  color?: string;
}) {
  const body = (
    <Card className="p-4 transition-colors hover:bg-(--bg-soft)">
      <p className="text-xs text-(--ink-soft)">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color }}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-(--ink-soft)">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
