"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PROPOSAL_TYPES, PROPOSAL_TYPE_LABEL, type ProposalType } from "../lib/proposal-types";

/** หน้า "การเชื่อมต่อ n8n" ฝั่ง client — ออก/ยกเลิก token · webhook + secret · นโยบายคำขอปรับ */

async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "ทำรายการไม่สำเร็จ");
  return json;
}

const btn = "inline-flex h-9 items-center rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) hover:bg-(--bg-soft) disabled:opacity-50";
const btnPrimary = "inline-flex h-9 items-center rounded-(--radius) bg-[#1A73E8] px-3 text-sm font-semibold text-white disabled:opacity-50";
const input = "h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)";

function Secret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-(--radius) border border-[#f0c36d] bg-[#FEF7E0] p-3 text-sm text-[#5c3d00]">
      <b>{label} — คัดลอกเก็บไว้ตอนนี้ ปิดแล้วดูอีกไม่ได้</b>
      <code className="block select-all break-all rounded bg-white/70 px-2 py-1.5 font-mono text-[13px] text-black">{value}</code>
      <div className="flex gap-2">
        <button
          type="button"
          className={btn}
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => toast.success("คัดลอกแล้ว"),
              () => toast.error("คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง")
            )
          }
        >
          คัดลอก
        </button>
        <button type="button" className={btn} onClick={onClose}>
          เก็บแล้ว ปิด
        </button>
      </div>
    </div>
  );
}

export function TokensPanel({
  tokens,
}: {
  tokens: { id: string; name: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("n8n");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }) : "-");

  return (
    <div className="flex flex-col gap-3">
      {fresh && <Secret label="Token ใหม่" value={fresh} onClose={() => setFresh(null)} />}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await call("/api/ads/agent/tokens", "POST", { name });
            setFresh(String(r.token));
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "ออก token ไม่สำเร็จ");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="token-name" className="text-sm text-(--ink-soft)">
          ชื่อ
        </label>
        <input id="token-name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="n8n เครื่องออฟฟิศ" />
        <button type="submit" disabled={busy} className={btnPrimary}>
          ออก token ใหม่
        </button>
      </form>
      {tokens.length === 0 ? (
        <p className="text-sm text-(--ink-soft)">ยังไม่มี token — ออกหนึ่งตัวแล้วใส่ใน n8n เป็น Header Auth: Authorization = Bearer &lt;token&gt;</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead className="border-b border-(--line) text-xs text-(--ink-soft)">
              <tr>
                <th className="px-2 py-2 text-left font-medium">ชื่อ</th>
                <th className="px-2 py-2 text-left font-medium">ขึ้นต้นด้วย</th>
                <th className="px-2 py-2 text-left font-medium">สร้าง</th>
                <th className="px-2 py-2 text-left font-medium">ใช้ล่าสุด</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-(--line) last:border-0">
                  <td className="px-2 py-2">{t.name}</td>
                  <td className="px-2 py-2 font-mono text-xs">{t.tokenPrefix}…</td>
                  <td className="px-2 py-2 whitespace-nowrap">{when(t.createdAt)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{when(t.lastUsedAt)}</td>
                  <td className="px-2 py-2 text-right">
                    {t.revokedAt ? (
                      <span className="text-xs text-(--ink-soft)">ยกเลิกแล้ว</span>
                    ) : (
                      <RevokeButton id={t.id} onDone={() => router.refresh()} />
                    )}
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

function RevokeButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <button type="button" className="text-xs text-[#B3261E] underline" onClick={() => setConfirm(true)}>
        ยกเลิก
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      n8n ที่ใช้ตัวนี้จะเรียกไม่ได้ทันที
      <button
        type="button"
        className="font-semibold text-[#B3261E] underline"
        onClick={async () => {
          try {
            await call(`/api/ads/agent/tokens/${id}`, "DELETE");
            toast.success("ยกเลิก token แล้ว");
            onDone();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
          }
        }}
      >
        ยืนยัน
      </button>
      <button type="button" className="underline" onClick={() => setConfirm(false)}>
        ไม่
      </button>
    </span>
  );
}

export function WebhookAndPolicyForm({
  initial,
}: {
  initial: {
    webhookUrl: string;
    hasWebhookSecret: boolean;
    allowedTypes: ProposalType[];
    maxBudgetChangePct: number;
    proposalExpiryHours: number;
    selfApprove: boolean;
  };
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      await call("/api/ads/agent/settings", "POST", {
        webhook_url: v.webhookUrl,
        allowed_types: v.allowedTypes,
        max_budget_change_pct: v.maxBudgetChangePct,
        proposal_expiry_hours: v.proposalExpiryHours,
        self_approve: v.selfApprove,
      });
      toast.success("บันทึกแล้ว");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="webhook-url" className="text-sm font-semibold">
          Webhook URL ของ n8n
        </label>
        <p className="text-xs text-(--ink-soft)">
          URL ของ Webhook node (Production URL) ที่รับ bot.message / proposal.approved / proposal.rejected — เครื่อง n8n อยู่หลังเราเตอร์ ใช้ Cloudflare Tunnel เปิดเฉพาะ path /webhook/
        </p>
        <input
          id="webhook-url"
          className={`${input} w-full max-w-xl`}
          value={v.webhookUrl}
          onChange={(e) => setV({ ...v, webhookUrl: e.target.value })}
          placeholder="https://n8n.example.com/webhook/smartboss-ads"
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-(--ink-soft)">Secret สำหรับเซ็น webhook: {initial.hasWebhookSecret ? "ตั้งแล้ว" : "ยังไม่ตั้ง"}</span>
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={async () => {
              try {
                const r = await call("/api/ads/agent/settings", "PUT", { action: "rotate_secret" });
                setSecret(String(r.secret));
                router.refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "ออก secret ไม่สำเร็จ");
              }
            }}
          >
            {initial.hasWebhookSecret ? "ออก secret ใหม่" : "ออก secret"}
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || !initial.webhookUrl || !initial.hasWebhookSecret}
            onClick={async () => {
              try {
                const r = await call("/api/ads/agent/settings", "PUT", { action: "ping" });
                if (r.ok) toast.success(`n8n ตอบกลับ HTTP ${r.status}`);
                else toast.error(`ส่งไม่ถึง n8n: ${String(r.error ?? `HTTP ${r.status}`)}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "ทดสอบไม่สำเร็จ");
              }
            }}
          >
            ทดสอบส่ง (ping)
          </button>
        </div>
        {secret && <Secret label="Webhook secret ใหม่ (ใส่ใน n8n ไว้ตรวจลายเซ็น)" value={secret} onClose={() => setSecret(null)} />}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">ชนิดคำขอที่ให้ AI เสนอได้</span>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {PROPOSAL_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.allowedTypes.includes(t)}
                onChange={(e) =>
                  setV({ ...v, allowedTypes: e.target.checked ? [...v.allowedTypes, t] : v.allowedTypes.filter((x) => x !== t) })
                }
              />
              {PROPOSAL_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">ปรับงบ/bid ได้ไม่เกิน (% ต่อครั้ง)</span>
          <input
            type="number"
            min={1}
            max={500}
            className={input}
            value={v.maxBudgetChangePct}
            onChange={(e) => setV({ ...v, maxBudgetChangePct: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">คำขอหมดอายุใน (ชั่วโมง)</span>
          <input
            type="number"
            min={1}
            max={720}
            className={input}
            value={v.proposalExpiryHours}
            onChange={(e) => setV({ ...v, proposalExpiryHours: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={v.selfApprove} onChange={(e) => setV({ ...v, selfApprove: e.target.checked })} />
          คนที่พิมพ์สั่งบอท อนุมัติคำขอของตัวเองได้
        </label>
      </div>

      <div>
        <button type="button" disabled={busy} onClick={save} className={btnPrimary}>
          บันทึก
        </button>
      </div>
    </div>
  );
}
