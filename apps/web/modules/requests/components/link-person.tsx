"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { linkPersonAction } from "../actions";
import { PersonPicker, type PickItem } from "./person-picker";
import { Notice } from "./ui";

/**
 * ใบเบิกที่พิมพ์ชื่อไว้ก่อน (ยังไม่มีในระบบ) — เลือกคนจริงเพื่อผูก (ผู้ใช้ 22/11/2569 ทาง ข)
 * ผูกได้ทุกสถานะ · จ่ายแล้ว = ลงบัญชีค่าแรง/รอหักเงินเดือนให้เอง
 */
export function LinkPersonPanel({ id, typedName, typedKind, people, paid }: { id: string; typedName: string; typedKind: "worker" | "staff"; people: PickItem[]; paid: boolean }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-amber-300 bg-amber-50 p-4">
      <div>
        <h2 className="text-base font-bold text-(--ink)">ผูกกับคนในระบบ</h2>
        <p className="mt-1 text-xs text-(--ink-soft)">
          ใบนี้ยื่นให้ <b>&ldquo;{typedName}&rdquo;</b> ({typedKind === "worker" ? "คนงานรายวัน" : "พนักงาน"}) ที่ยังไม่มีในระบบ · เพิ่มคนนี้เข้าระบบแล้วเลือกชื่อจริงที่นี่
          {paid ? " · จ่ายไปแล้ว: ระบบจะลงยอดที่ต้องหักคืนให้เอง (คนงาน = บัญชีค่าแรง · พนักงาน = รอหักเงินเดือน)" : ""}
        </p>
      </div>
      <PersonPicker label="คนไหน" placeholder="พิมพ์ชื่อ" emptyText="ไม่พบ — เพิ่มคนนี้เข้าระบบก่อน" items={people} value={userId} onChange={setUserId} />
      {error && <Notice tone="danger">{error}</Notice>}
      <button
        type="button"
        disabled={!userId || busy}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await linkPersonAction({ id, userId });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        ผูกชื่อ
      </button>
    </section>
  );
}
