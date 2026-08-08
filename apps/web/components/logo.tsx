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
      <span className="text-(--brand-green)">Smart</span>
      <span className="text-(--brand-navy)">Boss</span>
    </span>
  );
}
