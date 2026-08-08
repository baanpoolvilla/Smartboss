import * as React from "react";
import { cn } from "../lib/cn";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  src?: string | null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, name, src, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex h-9 w-9 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-[var(--module-color-bg)] text-xs font-semibold text-[var(--module-color)]",
        className
      )}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  )
);
Avatar.displayName = "Avatar";
