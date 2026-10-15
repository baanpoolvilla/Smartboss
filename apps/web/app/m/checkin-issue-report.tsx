"use client";

import { useT } from "./worker-lang";
import { useState } from "react";

/**
 * "ลงเวลาไม่ได้ · แจ้งไอที" ใต้ปุ่มลงเวลา (today.tsx) — กดปุ่มเดียวจบ ไม่ต้องเลือก/พิมพ์อะไร ไอทีตรวจสาเหตุเอง
 * (api/m/checkin-issue) · แนบใบยืนยันการกดที่ไม่ผ่านที่เซิร์ฟเวอร์ลงลายเซ็นไว้ (`proofs`) เป็นหลักฐานว่า
 * กดลงเวลาจริงตอนกี่โมง อยู่ตรงไหน + ตำแหน่งตอนกดแจ้ง
 */
export function CheckinIssueReport({ proofs, lastMessage }: { proofs: string[]; lastMessage: string | null }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [sent, setSent] = useState<{ code: string; attempts: number; at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    // ตำแหน่งตอนกดแจ้ง — ไม่รอนาน ไม่ได้ก็ส่งไปโดยไม่มี (หลักฐานหลักคือใบยืนยันจากเซิร์ฟเวอร์)
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
        enableHighAccuracy: true,
        timeout: 6000,
        maximumAge: 30_000,
      });
    });
    try {
      const response = await fetch("/api/m/checkin-issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proofs,
          lastMessage,
          latitude: position?.coords.latitude ?? null,
          longitude: position?.coords.longitude ?? null,
          accuracyM: position?.coords.accuracy ?? null,
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        attempts?: number;
        reportedAt?: string;
        error?: string;
      };
      if (!response.ok || !payload.code) {
        setError(payload.error ?? t("issueFailed"));
        return;
      }
      setSent({ code: payload.code, attempts: payload.attempts ?? 0, at: payload.reportedAt ?? new Date().toISOString() });
    } catch {
      setError(t("noInternet"));
    } finally {
      setState("idle");
    }
  }

  if (sent) {
    const time = new Date(sent.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    return (
      <div className="rounded-(--radius) bg-(--bg-soft) p-3 text-sm text-(--tone-ok)">
        ส่งเรื่องถึงไอทีแล้ว · เลขที่ {sent.code}
        <span className="block text-xs text-(--ink-soft)">
          {sent.attempts > 0
            ? `แนบหลักฐานการกดลงเวลา ${sent.attempts} ครั้ง (เวลาและตำแหน่งจากเซิร์ฟเวอร์) · แจ้งเมื่อ ${time} น.`
            : `บันทึกเวลาที่แจ้ง ${time} น. และตำแหน่งตอนนี้ไว้แล้ว`}
        </span>
        <span className="block text-xs text-(--ink-soft)">{t("issueSent")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={state === "sending"}
        onClick={() => void send()}
        className="rounded-full border border-(--line) px-4 py-1.5 text-sm text-(--ink-soft) disabled:opacity-60"
      >
        {state === "sending" ? t("issueSending") : t("issueButton")}
      </button>
      {error && <p className="text-xs text-(--danger)">{error}</p>}
    </div>
  );
}
