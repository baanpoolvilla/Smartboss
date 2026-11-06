"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { linkOtWorkerAction } from "../actions";
import { PersonPicker, type PickItem } from "./person-picker";
import { Notice } from "./ui";

/**
 * ใบ OT ที่พิมพ์ชื่อคนงานไว้ก่อน (ยังไม่มีในระบบ) — เลือกคนงานจริงเพื่อผูก
 * ผูกแล้วระบบตรวจลงเวลาเข้างาน/เวลาทับ และคิดค่า OT จากค่าแรง แล้วส่งให้ HR อนุมัติตามปกติ
 */
export function LinkWorkerPanel({ id, typedName, workers, optional = false }: { id: string; typedName: string; workers: PickItem[]; optional?: boolean }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-amber-300 bg-amber-50 p-4">
      <div>
        <h2 className="text-base font-bold text-(--ink)">ผูกกับคนงาน{optional && <span className="ml-1 text-xs font-normal text-(--ink-soft)">(ไม่บังคับ)</span>}</h2>
        <p className="mt-1 text-xs text-(--ink-soft)">
          ใบนี้ลงให้ <b>&ldquo;{typedName}&rdquo;</b> ที่ยังไม่มีในระบบ · เพิ่มคนงานเข้าระบบแล้วเลือกชื่อจริงที่นี่ ระบบจะตรวจลงเวลาเข้างานวันนั้น คิดค่า OT จากค่าแรง แล้วส่งให้ HR อนุมัติ
        </p>
      </div>
      <PersonPicker label="คนงานคนไหน" placeholder="พิมพ์ชื่อคนงาน" emptyText="ไม่พบ — เพิ่มคนงานเข้าระบบก่อน (ดูคู่มือ D2)" items={workers} value={userId} onChange={setUserId} />
      {error && <Notice tone="danger">{error}</Notice>}
      <button
        type="button"
        disabled={!userId || busy}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await linkOtWorkerAction({ id, userId });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        ผูกชื่อ แล้วส่งให้ HR ตรวจ
      </button>
    </section>
  );
}
