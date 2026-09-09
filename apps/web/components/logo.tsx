import { cn } from "@smartboss/ui/cn";

export function Logo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-3xl",
  };
  return (
    <span
      className={cn(
        "font-bold tracking-tight select-none",
        sizes[size],
        className
      )}
    >
      {/* Fixed hex, not --brand-green — that token gets repointed to each
          module's own accent color for buttons/focus rings (see
          [data-app="..."] rules in each module's theme.css), which washed
          the wordmark out to slate/teal inside a module instead of the
          true logo green ("สีเอาเป็นสีนี้เท่านั้น"). The wordmark must stay
          the same color everywhere regardless of which module it sits in. */}
      <span style={{ color: "#4cb93f" }}>Smart</span>
      <span className="text-(--brand-navy)">Boss</span>
    </span>
  );
}
