"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Loader2, LogOut } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { useShell } from "@/components/shell/shell-context";
import { Modal } from "./dialog";

/**
 * ปุ่มขวาสุดของ AppBar — NotificationBell + ปุ่มออกจากระบบ (พร้อมกล่องยืนยัน)
 * จำนวนแจ้งเตือนดึงจาก ShellProvider จึงไม่ query ซ้ำในทุกหน้า
 */
export function AppBarActions() {
  const { unread } = useShell();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
    <>
      <Link
        href="/notifications"
        className="relative rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
        aria-label="การแจ้งเตือน"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="ออกจากระบบ"
        aria-label="ออกจากระบบ"
        className="rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
      >
        <LogOut className="h-5 w-5" />
      </button>

      {confirming && (
        <Modal
          title="ยืนยันการออกจากระบบ"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={loading}
              >
                ยกเลิก
              </Button>
              <Button onClick={onLogout} disabled={loading} className="gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                ออกจากระบบ
              </Button>
            </>
          }
        >
          <p className="text-sm text-(--ink)">
            คุณต้องการออกจากระบบหรือไม่?
          </p>
        </Modal>
      )}
    </>
  );
}
