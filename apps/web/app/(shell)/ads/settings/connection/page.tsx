import { requireAdsPage } from "@/modules/ads/data/access";
import { lastSyncedAt, listAccounts, listSyncLogs } from "@/modules/ads/data/accounts";
import { prisma } from "@smartboss/database";
import { listAgentTokens } from "@/modules/ads/data/agent-auth";
import { approverIds, botChannelId } from "@/modules/ads/data/bot";
import { CHAT_PAGE_PATH } from "@/modules/chat/constants";
import { AGENT_OFFLINE_AFTER_MINUTES, agentOnline, loadAgentSettings } from "@/modules/ads/data/agent-settings";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { JOB_TYPE_LABEL, SYNC_STATUS_LABEL } from "@/modules/ads/constants";
import { fmtDateTime, fmtNum } from "@/modules/ads/lib/format";
import { formatPeriod, fromDbDate } from "@/modules/ads/lib/periods";
import { TokensPanel, WebhookAndPolicyForm } from "@/modules/ads/components/agent-connection";
import { AdsPage } from "@/modules/ads/components/page-shell";
import { Section } from "@/modules/ads/components/ui";

export const dynamic = "force-dynamic";

/** การเชื่อมต่อ n8n (ผู้ดูแลระบบ) — token · webhook · นโยบายคำขอปรับ · ประวัติการรับข้อมูล */
export default async function AdsConnectionPage() {
  const session = await requireAdsPage(ADS_PERMS.admin);
  const [accounts, logs, lastSync, tokens, agent, approvers] = await Promise.all([
    listAccounts(session.orgId),
    listSyncLogs(session.orgId),
    lastSyncedAt(session.orgId),
    listAgentTokens(session.orgId),
    loadAgentSettings(session.orgId),
    approverIds(session.orgId),
  ]);
  const approverNames = approvers.length
    ? (await prisma.user.findMany({ where: { orgId: session.orgId, id: { in: approvers } }, select: { name: true }, orderBy: { name: "asc" } })).map((u) => u.name)
    : [];
  const accountName = new Map(accounts.map((a) => [a.customerId, a.name]));
  const online = agentOnline(agent.lastSeenAt);

  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="text-(--ink-soft)">{label}</dt>
      <dd className="break-all text-(--ink)">{value ?? <span className="text-(--ink-soft)">-</span>}</dd>
    </>
  );

  return (
    <AdsPage title="การเชื่อมต่อ n8n" lastSynced={lastSync}>
      <Section title="สถานะ">
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[220px_1fr]">
          {row(
            "n8n",
            <span className={online ? "font-semibold text-[#137333]" : "font-semibold text-[#B3261E]"}>
              {online ? "ออนไลน์" : agent.lastSeenAt ? `ออฟไลน์ (เงียบเกิน ${AGENT_OFFLINE_AFTER_MINUTES} นาที)` : "ยังไม่เคยติดต่อมา"}
            </span>
          )}
          {row("ติดต่อมาล่าสุด", agent.lastSeenAt ? fmtDateTime(agent.lastSeenAt) : null)}
          {row(
            "heartbeat ล่าสุด",
            agent.lastSeenInfo ? (
              <code className="text-xs">{JSON.stringify(agent.lastSeenInfo)}</code>
            ) : null
          )}
          {row("บัญชีโฆษณา", accounts.length ? accounts.map((a) => `${a.name ?? "-"} (${a.customerId})`).join(" · ") : "ยังไม่มี — n8n ส่ง POST /api/agent/ads/accounts")}
        </dl>
      </Section>

      <Section
        title="กลุ่ม 🤖 Ads Agent (คนอนุมัติ)"
        description="สมาชิกกลุ่มทุกคนกดอนุมัติ/ปฏิเสธคำขอปรับได้ กดได้ครั้งเดียว คนแรกชนะ · เพิ่ม/เอาคนออกที่เมนูสมาชิกของกลุ่มในแชท"
        action={
          <a href={`${CHAT_PAGE_PATH}?c=${encodeURIComponent(botChannelId(session.orgId))}`} className="text-sm text-[#1A73E8] underline">
            เปิดกลุ่มในแชท
          </a>
        }
      >
        {approverNames.length === 0 ? (
          <p className="text-sm text-[#B3261E]">ยังไม่มีสมาชิก — คำขอปรับจะไม่มีใครกดอนุมัติได้ เปิดกลุ่มในแชทแล้วเพิ่มคน</p>
        ) : (
          <p className="text-sm text-(--ink)">
            {approverNames.length} คน: {approverNames.join(", ")}
          </p>
        )}
      </Section>

      <Section title="Token ของ n8n" description="n8n ใช้เรียก API ของ Smartboss — ผูกกับบริษัทนี้ · ตัวเต็มแสดงครั้งเดียว · ยกเลิกได้ทันที">
        <TokensPanel
          tokens={tokens.map((t) => ({
            ...t,
            createdAt: t.createdAt.toISOString(),
            lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
            revokedAt: t.revokedAt?.toISOString() ?? null,
          }))}
        />
      </Section>

      <Section title="Webhook และนโยบายคำขอปรับ">
        <WebhookAndPolicyForm
          initial={{
            webhookUrl: agent.webhookUrl ?? "",
            hasWebhookSecret: agent.hasWebhookSecret,
            allowedTypes: agent.allowedTypes,
            maxBudgetChangePct: agent.maxBudgetChangePct,
            proposalExpiryHours: agent.proposalExpiryHours,
            selfApprove: agent.selfApprove,
          }}
        />
      </Section>

      <Section title="API สำหรับ n8n" description="ทุกตัวต้องส่ง Authorization: Bearer <token> · รายละเอียดเต็มอยู่ในเอกสาร docs/ads-n8n-api.md">
        <ul className="grid gap-1 font-mono text-[12.5px] text-(--ink) sm:grid-cols-2">
          <li>POST /api/agent/ads/heartbeat</li>
          <li>POST /api/agent/ads/accounts</li>
          <li>POST /api/agent/ads/ingest/campaigns</li>
          <li>POST /api/agent/ads/ingest/ad-groups</li>
          <li>POST /api/agent/ads/ingest/keywords</li>
          <li>POST /api/agent/ads/ingest/search-terms</li>
          <li>POST /api/agent/ads/ingest/complete</li>
          <li>GET  /api/agent/ads/report</li>
          <li>GET  /api/agent/ads/search-terms</li>
          <li>GET  /api/agent/ads/settings</li>
          <li>POST /api/agent/ads/summaries</li>
          <li>GET|POST /api/agent/ads/proposals</li>
          <li>GET  /api/agent/ads/proposals/:id</li>
          <li>POST /api/agent/ads/proposals/:id/claim</li>
          <li>POST /api/agent/ads/proposals/:id/result</li>
          <li>POST /api/agent/ads/proposals/:id/measurement</li>
          <li>POST /api/agent/ads/messages</li>
          <li>POST /api/agent/ads/typing</li>
          <li>GET  /api/agent/ads/group</li>
        </ul>
      </Section>

      <Section title="ประวัติการรับข้อมูล" description="50 รอบล่าสุด (n8n ส่ง POST /api/agent/ads/ingest/complete ตอนจบรอบ)">
        {logs.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">ยังไม่มี</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="border-b border-(--line) text-xs text-(--ink-soft)">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">เริ่ม</th>
                  <th className="px-2 py-2 text-left font-medium">บัญชี</th>
                  <th className="px-2 py-2 text-left font-medium">ที่มา</th>
                  <th className="px-2 py-2 text-left font-medium">ช่วงข้อมูล</th>
                  <th className="px-2 py-2 text-right font-medium">แถว</th>
                  <th className="px-2 py-2 text-right font-medium">เวลา</th>
                  <th className="px-2 py-2 text-left font-medium">ผล</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={String(l.id)} className="border-b border-(--line) align-top last:border-0">
                    <td className="px-2 py-2 whitespace-nowrap">{fmtDateTime(l.startedAt)}</td>
                    <td className="px-2 py-2">{(l.customerId && accountName.get(l.customerId)) ?? l.customerId}</td>
                    <td className="px-2 py-2">{JOB_TYPE_LABEL[l.jobType ?? ""] ?? l.jobType}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {l.rangeFrom && l.rangeTo ? formatPeriod({ from: fromDbDate(l.rangeFrom), to: fromDbDate(l.rangeTo) }) : "-"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNum(l.rowsUpserted)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.durationMs != null ? `${fmtNum(l.durationMs / 1000, 1)} วิ` : "-"}</td>
                    <td className="px-2 py-2">
                      <span className={l.status === "failed" ? "font-medium text-[#8F1414]" : "text-[#14532D]"}>{SYNC_STATUS_LABEL[l.status ?? ""] ?? l.status}</span>
                      {l.errorMessage && <div className="mt-0.5 max-w-md text-xs text-(--ink-soft)">{l.errorMessage}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </AdsPage>
  );
}
