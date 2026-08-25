"use client";

import { useActionState, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { issueDeviceTokenAction, type IssueTokenState } from "../actions";

const EMPTY: IssueTokenState = {};

/**
 * ปุ่มออกโทเคนผูกเครื่อง + กล่องแสดงค่าที่ได้
 *
 * ต้องเป็น client component เพราะ `<form action={serverAction}>` แบบธรรมดา
 * ทิ้งค่าที่ action คืนมาเสมอ — ซึ่งเดิมทำให้โทเคนถูกสร้างขึ้นจริงแต่ไม่มีใครเห็น
 * กดกี่ครั้งก็เหมือนปุ่มเสีย (และสะสมโทเคนที่ไม่มีวันถูกใช้ไว้ในฐานข้อมูล)
 */
export function IssueTokenButton({ deviceId }: { deviceId: string }) {
  const [state, formAction, pending] = useActionState(issueDeviceTokenAction, EMPTY);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // เบราว์เซอร์บล็อกคลิปบอร์ด (เช่นเปิดผ่าน http) — ผู้ใช้ยังลากเลือกเองได้
      setCopied(false);
    }
  }

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="deviceId" value={deviceId} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "กำลังออกโทเคน…" : "ออกโทเคนผูกเครื่อง"}
        </Button>
      </form>

      {state.error && <p className="text-xs text-(--danger)">{state.error}</p>}

      {state.token && (
        <div className="max-w-md rounded-(--radius) border border-(--line) bg-(--bg-soft) p-2">
          <p className="mb-1 text-xs text-(--ink-soft)">
            คัดลอกไปวางที่เครื่อง — ใช้ได้ครั้งเดียว
            {state.expiresAt
              ? ` · หมดอายุ ${new Date(state.expiresAt).toLocaleString("th-TH")}`
              : ""}
          </p>
          <code className="block break-all font-mono text-xs">{state.token}</code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={copy}
          >
            {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
          </Button>
        </div>
      )}
    </div>
  );
}
