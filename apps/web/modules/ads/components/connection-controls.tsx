"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { fmtDateTime } from "../lib/format";

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
  return json;
}

const btn =
  "inline-flex h-9 items-center gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) hover:bg-(--bg-soft) disabled:opacity-60";

/** บัญชีที่ดึง (spec §7 หน้า 4) — ดึงรายชื่อจาก MCC, เปิด/ปิดซิงค์, ซิงค์ทันที, Backfill */
export function AccountsPanel({
  accounts,
}: {
  accounts: { customerId: string; name: string | null; currencyCode: string | null; timeZone: string | null; syncEnabled: boolean; lastSyncedAt: string | null; syncing: boolean }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [months, setMonths] = useState(24);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.success(await fn());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const sync = (customerId: string | null, jobType: "manual" | "backfill") =>
    run(`${jobType}:${customerId ?? "all"}`, async () => {
      await call("/api/ads/sync", {
        method: "POST",
        body: JSON.stringify({ customer_id: customerId, job_type: jobType, months }),
      });
      return jobType === "backfill"
        ? `เริ่ม Backfill ย้อนหลัง ${months} เดือนแล้ว — ดูผลในประวัติการซิงค์`
        : "เริ่มซิงค์แล้ว — ดูผลในประวัติการซิงค์";
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn}
          disabled={busy != null}
          onClick={() =>
            run("discover", async () => {
              const r = await call("/api/ads/accounts", { method: "POST" });
              return `พบบัญชีใหม่ ${r.added} · อัปเดต ${r.updated}${Number(r.skipped) ? ` · ข้าม ${r.skipped} (ผูกกับบริษัทอื่น)` : ""}`;
            })
          }
        >
          {busy === "discover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          ดึงรายชื่อบัญชีจาก MCC
        </button>
        <button type="button" className={btn} disabled={busy != null || accounts.length === 0} onClick={() => sync(null, "manual")}>
          {busy === "manual:all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          ซิงค์ทันที (ทุกบัญชีที่เปิด)
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-(--ink-soft)">
          Backfill ย้อนหลัง
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)"
          >
            {[12, 18, 24].map((m) => (
              <option key={m} value={m}>
                {m} เดือน
              </option>
            ))}
          </select>
        </label>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-(--ink-soft)">ยังไม่มีบัญชี — กด “ดึงรายชื่อบัญชีจาก MCC”</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="border-b border-(--line) text-xs text-(--ink-soft)">
              <tr>
                <th className="px-2 py-2 text-left font-medium">บัญชี</th>
                <th className="px-2 py-2 text-left font-medium">สกุลเงิน / เขตเวลา</th>
                <th className="px-2 py-2 text-left font-medium">ซิงค์ล่าสุด</th>
                <th className="px-2 py-2 text-center font-medium">ซิงค์อัตโนมัติ</th>
                <th className="px-2 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.customerId} className="border-b border-(--line) last:border-0">
                  <td className="px-2 py-2">
                    <div className="font-medium text-(--ink)">{a.name ?? "-"}</div>
                    <div className="text-xs text-(--ink-soft)">{a.customerId}</div>
                  </td>
                  <td className="px-2 py-2 text-(--ink-soft)">
                    {a.currencyCode ?? "-"} · {a.timeZone ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-(--ink-soft)">{a.syncing ? "กำลังซิงค์…" : fmtDateTime(a.lastSyncedAt)}</td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={a.syncEnabled}
                      disabled={busy != null}
                      onChange={(e) =>
                        run(`toggle:${a.customerId}`, async () => {
                          await call("/api/ads/accounts", {
                            method: "PATCH",
                            body: JSON.stringify({ customer_id: a.customerId, sync_enabled: e.target.checked }),
                          });
                          return e.target.checked ? "เปิดซิงค์อัตโนมัติแล้ว" : "ปิดซิงค์อัตโนมัติแล้ว";
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-2">
                      <button type="button" className={btn} disabled={busy != null || a.syncing} onClick={() => sync(a.customerId, "manual")}>
                        ซิงค์ทันที
                      </button>
                      <button type="button" className={btn} disabled={busy != null || a.syncing} onClick={() => sync(a.customerId, "backfill")}>
                        Backfill
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
