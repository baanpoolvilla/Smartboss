"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smartboss/ui/components/button";
import { PasswordInput } from "@/components/password-input";
import { inputClass } from "@/modules/admin/components/ui";
import {
  cancelTwoFactorSetupAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  startTwoFactorAction,
} from "./actions";

/**
 * เปิด/ปิดยืนยันตัวตน 2 ชั้น — ทำได้จบในมือถือเครื่องเดียว (ปุ่ม "เปิดในแอป Authenticator")
 * หรือสแกน QR จากจอคอมด้วยมือถือ · ทุกขั้นบอกว่ากำลังเกิดอะไรและต้องทำอะไรต่อ
 */
type Setup = { secret: string; uri: string; qr: string };

function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-(--radius) border border-(--danger-line) bg-(--danger-bg) px-3 py-2 text-sm text-(--danger)">
      {text}
    </p>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-(--radius) border border-(--tone-warn) p-3">
        <p className="text-sm font-semibold text-(--ink)">เก็บรหัสสำรองชุดนี้ไว้ — แสดงครั้งเดียว</p>
        <p className="mt-1 text-xs text-(--ink-soft)">
          ใช้แทนรหัส 6 หลักได้เมื่อมือถือหายหรือเปลี่ยนเครื่อง รหัสละ 1 ครั้ง · จดลงกระดาษ ถ่ายภาพหน้าจอ
          หรือเก็บในที่ที่ไม่ใช่มือถือเครื่องเดียวกับแอป Authenticator
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
        {codes.map((c) => (
          <li key={c} className="rounded-md border border-(--line) bg-(--bg-soft) px-2 py-2 text-center text-(--ink)">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:w-44"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "คัดลอกแล้ว ✓" : "คัดลอกทั้งหมด"}
        </Button>
        <Button type="button" className="h-11 sm:w-44" onClick={onDone}>
          เก็บเรียบร้อยแล้ว
        </Button>
      </div>
    </div>
  );
}

export function TwoFactorPanel({
  enabled,
  enabledAtText,
  recoveryLeft,
  required,
}: {
  enabled: boolean;
  enabledAtText: string | null;
  recoveryLeft: number;
  required: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<null | "disable" | "regenerate">(null);
  const [password, setPassword] = useState("");
  const [showKey, setShowKey] = useState(false);

  function finish() {
    setCodes(null);
    setSetup(null);
    setCode("");
    setMode(null);
    setPassword("");
    setError(null);
    // หลุดจากโหมด "ต้องตั้งก่อนใช้งาน" — โหลดใหม่ให้เมนูกลับมาใช้ได้
    router.replace("/account/security");
    router.refresh();
  }

  if (codes) return <RecoveryCodes codes={codes} onDone={finish} />;

  if (enabled) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full bg-(--brand-navy,var(--ink)) px-2.5 text-xs font-semibold text-white">
            เปิดอยู่
          </span>
          <p className="text-sm text-(--ink)">
            เข้าสู่ระบบด้วยอีเมล/รหัสผ่านต้องกรอกรหัส 6 หลักจากแอปทุกครั้ง
            {enabledAtText ? <span className="text-(--ink-soft)"> · เปิดเมื่อ {enabledAtText}</span> : null}
          </p>
        </div>
        <p className={`text-xs ${recoveryLeft <= 2 ? "font-semibold text-(--danger)" : "text-(--ink-soft)"}`}>
          รหัสสำรองเหลือ {recoveryLeft} รหัส{recoveryLeft <= 2 ? " — ควรออกชุดใหม่" : ""}
        </p>

        {mode === null ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="h-11 sm:w-48" onClick={() => setMode("regenerate")}>
              ออกรหัสสำรองชุดใหม่
            </Button>
            <Button type="button" variant="outline" className="h-11 sm:w-48" onClick={() => setMode("disable")}>
              ปิดยืนยันตัวตน 2 ชั้น
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3 rounded-(--radius) border border-(--line) p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                if (mode === "disable") {
                  const r = await disableTwoFactorAction(password);
                  if (!r.ok) return setError(r.error);
                  finish();
                } else {
                  const r = await regenerateRecoveryCodesAction(password);
                  if (!r.ok) return setError(r.error);
                  setPassword("");
                  setMode(null);
                  setCodes(r.recoveryCodes);
                }
              });
            }}
          >
            <p className="text-sm text-(--ink)">
              {mode === "disable"
                ? required
                  ? "บริษัทกำหนดให้บทบาทของคุณต้องเปิด 2 ชั้น — ปิดแล้วระบบจะให้ตั้งใหม่ก่อนใช้งานต่อ (ใช้ตอนเปลี่ยนมือถือ)"
                  : "ปิดแล้วจะเข้าสู่ระบบได้ด้วยรหัสผ่านอย่างเดียวเหมือนเดิม"
                : "รหัสสำรองชุดเดิมจะใช้ไม่ได้ทันที"}{" "}
              · กรอกรหัสผ่านปัจจุบันเพื่อยืนยันว่าเป็นคุณ
            </p>
            <PasswordInput
              name="password"
              required
              autoComplete="current-password"
              className={inputClass}
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
            <ErrorNote text={error} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={pending || !password} className="h-11 sm:w-40">
                {pending ? "กำลังตรวจ…" : "ยืนยัน"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:w-32"
                onClick={() => {
                  setMode(null);
                  setPassword("");
                  setError(null);
                }}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-(--ink)">
          ตอนนี้เข้าสู่ระบบได้ด้วยรหัสผ่านอย่างเดียว — เปิด 2 ชั้นแล้ว ถึงรหัสผ่านหลุด
          คนอื่นก็เข้าไม่ได้ถ้าไม่มีมือถือของคุณ
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-(--ink-soft)">
          <li>ลงแอป Google Authenticator หรือ Microsoft Authenticator ในมือถือ (ฟรี)</li>
          <li>กด “เริ่มตั้งค่า” แล้วสแกน QR หรือกดเปิดในแอป</li>
          <li>กรอกรหัส 6 หลักที่แอปแสดง แล้วเก็บรหัสสำรองไว้</li>
        </ol>
        <ErrorNote text={error} />
        <Button
          type="button"
          disabled={pending}
          className="h-11 w-full sm:w-48"
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await startTwoFactorAction();
              if (!r.ok) return setError(r.error);
              setSetup({ secret: r.secret, uri: r.uri, qr: r.qr });
            });
          }}
        >
          {pending ? "กำลังเตรียม…" : "เริ่มตั้งค่า"}
        </Button>
        <p className="text-xs text-(--ink-soft)">
          เข้าผ่านแอป LINE ไม่ถามรหัส 6 หลัก — บัญชี LINE ในมือถือของคุณถือเป็นการยืนยันชั้นที่สองอยู่แล้ว
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await confirmTwoFactorAction(code);
          if (!r.ok) {
            setCode("");
            return setError(r.error);
          }
          setCodes(r.recoveryCodes);
        });
      }}
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL ที่สร้างฝั่งเซิร์ฟเวอร์ ไม่ผ่านตัวปรับรูป */}
        <img src={setup.qr} alt="QR สำหรับแอป Authenticator" width={200} height={200} className="hidden rounded-md border border-(--line) bg-white p-1 sm:block" />
        <div className="flex w-full flex-1 flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-(--ink)">1. เพิ่มบัญชีในแอป Authenticator</p>
            <p className="mt-1 hidden text-xs text-(--ink-soft) sm:block">เปิดแอปในมือถือ กด + แล้วสแกน QR นี้</p>
            <p className="mt-1 text-xs text-(--ink-soft) sm:hidden">กำลังใช้มือถือเครื่องที่ลงแอปไว้: กดปุ่มด้านล่าง แอปจะเพิ่มบัญชีให้เอง</p>
          </div>
          <a
            href={setup.uri}
            className="inline-flex h-11 items-center justify-center rounded-(--radius) border border-(--line) px-4 text-sm font-medium text-(--ink) hover:bg-(--bg-soft) sm:hidden"
          >
            เปิดในแอป Authenticator
          </a>
          <button type="button" onClick={() => setShowKey((v) => !v)} className="self-start text-xs text-(--ink-soft) underline underline-offset-2">
            {showKey ? "ซ่อนรหัสตั้งค่า" : "สแกน/เปิดแอปไม่ได้? พิมพ์รหัสตั้งค่าเอง"}
          </button>
          {showKey && (
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- เหมือนด้านบน: บนมือถือโชว์ QR เมื่อขอดูเท่านั้น (ไว้สแกนด้วยอีกเครื่อง) */}
              <img src={setup.qr} alt="QR สำหรับแอป Authenticator" width={200} height={200} className="self-center rounded-md border border-(--line) bg-white p-1 sm:hidden" />
              <code className="break-all rounded-md border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </code>
              <p className="text-xs text-(--ink-soft)">ในแอปเลือก “ป้อนรหัสตั้งค่า” · ชนิด: ตามเวลา (Time-based)</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="totp-confirm" className="text-sm font-semibold text-(--ink)">
          2. กรอกรหัส 6 หลักที่แอปแสดง
        </label>
        <input
          id="totp-confirm"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          className={`${inputClass} text-center text-lg tracking-[0.3em] sm:w-48`}
          required
        />
      </div>

      <ErrorNote text={error} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending || code.length !== 6} className="h-11 sm:w-44">
          {pending ? "กำลังตรวจ…" : "ยืนยันและเปิดใช้"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:w-32"
          onClick={() =>
            start(async () => {
              await cancelTwoFactorSetupAction();
              setSetup(null);
              setCode("");
              setError(null);
            })
          }
        >
          ยกเลิก
        </Button>
      </div>
      <p className="text-xs text-(--ink-soft)">ยังไม่มีผลจนกว่าจะกดยืนยัน — ปิดหน้านี้ไปก่อนก็ยังเข้าระบบได้ตามเดิม</p>
    </form>
  );
}
