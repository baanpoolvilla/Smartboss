"use client";

import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

export function LogoutButton({
  className,
  variant = "sidebar",
}: {
  className?: string;
  variant?: "sidebar" | "menu";
}) {
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // โหลดหน้าใหม่ทั้งหน้า ไม่ใช่ router.replace — หน้าที่มีตัวซิงก์เบื้องหลัง
      // (Kanban: TaskSync/realtime) ค้างสถานะฝั่ง client และ router cache ไว้
      // ทำให้ออกจากระบบแล้วยังเด้งกลับหน้าเดิม ล้างทุกอย่างด้วย hard navigation
      window.location.replace("/login");
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
