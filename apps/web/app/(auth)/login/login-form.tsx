"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";

/** ยอมรับเฉพาะ relative path เพื่อกัน open redirect */
function safeNext(next: string | undefined): string {
  if (!next) return "/";
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

/** ตัวนับ "ไม่ได้ใช้งาน" ของ components/shell/security-guards.tsx — เข้าระบบใหม่ต้องเริ่มนับใหม่ */
const ACTIVITY_KEY = "sb-last-activity";

function resetIdleClock(value: string | null) {
  try {
    if (value === null) localStorage.removeItem(ACTIVITY_KEY);
    else localStorage.setItem(ACTIVITY_KEY, value);
  } catch {
    // เขียนไม่ได้ (โหมดส่วนตัว) ก็ไม่เป็นไร
  }
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** บัญชีนี้เปิดยืนยันตัวตน 2 ชั้น — รหัสผ่านถูกแล้ว รอรหัส 6 หลัก */
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  // เวลาที่จดไว้จากรอบก่อนต้องไม่ทำให้รอบใหม่ถูกเด้งออกทันที
  useEffect(() => resetIdleClock(null), []);
  useEffect(() => {
    if (needCode) codeRef.current?.focus();
  }, [needCode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(needCode && code.trim() ? { code: code.trim() } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        recoveryLeft?: number;
      };
      if (!res.ok) {
        if (data.code === "TOTP_REQUIRED") {
          // ไม่ใช่ข้อผิดพลาด — แค่ยังไม่ได้กรอกรหัสชั้นที่สอง
          setNeedCode(true);
          setCode("");
          setLoading(false);
          return;
        }
        if (data.code === "TOTP_INVALID") setCode("");
        else if (needCode) {
          // รหัสผ่านใช้ไม่ได้แล้ว/บัญชีถูกล็อกระหว่างทาง — กลับไปขั้นแรก
          setNeedCode(false);
          setCode("");
        }
        setError(data.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        setLoading(false);
        return;
      }
      resetIdleClock(String(Date.now()));
      if (typeof data.recoveryLeft === "number") {
        // เข้าด้วยรหัสสำรอง — พาไปหน้าความปลอดภัยให้เห็นว่าเหลือกี่รหัส และออกชุดใหม่/ตั้งแอปใหม่ได้
        router.replace(`/account/security?recovery=${data.recoveryLeft}`);
        router.refresh();
        return;
      }
      router.replace(safeNext(next));
      router.refresh();
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {notice && !error && (
        <div
          role="status"
          className="rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2.5 text-sm text-(--ink)"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-(--radius) border border-(--danger-line) bg-(--danger-bg) px-3 py-2.5 text-sm text-(--danger)"
        >
          {error}
        </div>
      )}

      {needCode && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5 rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-(--ink)" />
            <p className="text-sm text-(--ink)">
              บัญชีนี้เปิด<strong>ยืนยันตัวตน 2 ชั้น</strong>ไว้ — เปิดแอป Authenticator ในมือถือ
              แล้วกรอกรหัส 6 หลักของ SmartBoss
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-sm font-medium text-(--ink)">
              รหัส 6 หลัก
            </label>
            <Input
              id="code"
              ref={codeRef}
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.slice(0, 12))}
              disabled={loading}
              required
              className="text-center text-lg tracking-[0.3em]"
            />
            <p className="text-xs text-(--ink-soft)">
              มือถือหาย/เปลี่ยนเครื่อง: กรอก<strong>รหัสสำรอง</strong> (รูปแบบ XXXXX-XXXXX ที่ได้ตอนเปิดใช้) แทนได้
              · ไม่มีทั้งคู่ให้แจ้งผู้ดูแลของบริษัทล้างให้
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setNeedCode(false);
              setCode("");
              setError(null);
            }}
            className="self-start text-xs text-(--ink-soft) underline-offset-2 hover:underline"
          >
            ← กลับไปกรอกอีเมล/รหัสผ่านใหม่
          </button>
        </div>
      )}

      <div className={needCode ? "hidden" : "flex flex-col gap-1.5"}>
        <label htmlFor="email" className="text-sm font-medium text-(--ink)">
          อีเมล
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@smartboss.app"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          required
        />
      </div>

      <div className={needCode ? "hidden" : "flex flex-col gap-1.5"}>
        <label
          htmlFor="password"
          className="text-sm font-medium text-(--ink)"
        >
          รหัสผ่าน
        </label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-(--ink-soft) transition-colors hover:text-(--ink)"
            aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="mt-1 w-full">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            กำลังเข้าสู่ระบบ...
          </>
        ) : (
          needCode ? "ยืนยันรหัส" : "เข้าสู่ระบบ"
        )}
      </Button>
    </form>
  );
}
