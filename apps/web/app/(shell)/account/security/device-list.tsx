"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Monitor, Smartphone } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";

export interface DeviceRow {
  id: string;
  label: string;
  mobile: boolean;
  lastActiveText: string;
  ip: string | null;
}

/**
 * อุปกรณ์ที่ยังเข้าสู่ระบบบัญชีนี้อยู่ — เจ้าของบัญชีดูเองและเตะออกเองได้
 * "เครื่องนี้" หาจาก /api/auth/refresh/current (ที่เดียวที่อ่าน cookie ของ session เครื่องนี้ได้)
 */
export function DeviceList({ devices }: { devices: DeviceRow[] }) {
  const router = useRouter();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/refresh/current", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { id?: string | null } | null) => {
        if (alive) setCurrentId(d?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [devices.length]);

  // เครื่องนี้ขึ้นก่อนเสมอ
  const rows = [...devices].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
  const others = devices.filter((d) => d.id !== currentId).length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-(--line) rounded-(--radius) border border-(--line)">
        {rows.map((d) => {
          const isCurrent = d.id === currentId;
          const Icon = d.mobile ? Smartphone : Monitor;
          return (
            <li key={d.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-(--ink-soft)" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-(--ink)">
                    {d.label}
                    {isCurrent && (
                      <span className="rounded-full bg-(--brand-navy,var(--ink)) px-2 py-0.5 text-[11px] font-semibold text-white">
                        เครื่องนี้
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-(--ink-soft)">
                    ใช้งานล่าสุด {d.lastActiveText}
                    {d.ip ? ` · IP ${d.ip}` : ""}
                  </p>
                </div>
              </div>
              {!isCurrent && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  className="h-10 shrink-0 sm:h-9"
                  onClick={() => {
                    if (!window.confirm(`ออกจากระบบ "${d.label}" ?`)) return;
                    setMessage(null);
                    start(async () => {
                      const r = await revokeSessionAction(d.id);
                      setMessage(r.ok ? `ออกจากระบบ ${d.label} แล้ว — เครื่องนั้นจะหลุดภายในไม่เกิน 15 นาที` : r.error);
                      router.refresh();
                    });
                  }}
                >
                  ออกจากระบบเครื่องนี้
                </Button>
              )}
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-3 text-sm text-(--ink-soft)">ไม่พบอุปกรณ์ที่เข้าสู่ระบบอยู่</li>}
      </ul>

      {message && (
        <p role="status" className="rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">
          {message}
        </p>
      )}

      {others > 0 && (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          className="h-11 w-full sm:w-64"
          onClick={() => {
            if (!window.confirm(`ออกจากระบบอุปกรณ์อื่นทั้ง ${others} เครื่อง? (เครื่องนี้ยังใช้ต่อได้)`)) return;
            setMessage(null);
            start(async () => {
              const r = await revokeOtherSessionsAction(currentId);
              setMessage(r.ok ? `ออกจากระบบอุปกรณ์อื่น ${r.count} เครื่องแล้ว — จะหลุดภายในไม่เกิน 15 นาที` : r.error);
              router.refresh();
            });
          }}
        >
          ออกจากระบบอุปกรณ์อื่นทั้งหมด
        </Button>
      )}

      <p className="text-xs text-(--ink-soft)">
        เห็นอุปกรณ์ที่ไม่รู้จัก: กดออกจากระบบเครื่องนั้น แล้วเปลี่ยนรหัสผ่านที่แท็บ “โปรไฟล์” ทันที
      </p>
    </div>
  );
}
