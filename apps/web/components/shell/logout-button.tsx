"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

export function LogoutButton({
  className,
  variant = "sidebar",
}: {
  className?: string;
  variant?: "sidebar" | "menu";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={loading}
      className={cn(
        "flex items-center gap-2 text-sm transition-colors disabled:opacity-60",
        variant === "sidebar"
          ? "w-full rounded-(--radius) border border-(--line) px-3 py-2 text-(--ink) hover:bg-(--bg-soft)"
          : "w-full rounded-[calc(var(--radius)-4px)] px-3 py-2 text-(--danger) hover:bg-(--danger-bg)",
        className
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogOut className="h-4 w-4" />
      )}
      ออกจากระบบ
    </button>
  );
}
