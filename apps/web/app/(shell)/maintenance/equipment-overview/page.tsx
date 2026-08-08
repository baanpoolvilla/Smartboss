import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listPmSchedules } from "@/modules/maintenance/data/pm";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listAssets } from "@/modules/maintenance/data/assets";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { freqLabel } from "@/modules/maintenance/lib/pm-schedule";
import { ChipLink } from "@/modules/maintenance/components/ui";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

/** 3 ประเภทอุปกรณ์ + คำค้น — ตรงกับ _EquipType เดิม */
const TYPES = [
  { key: "air", label: "❄️ แอร์", keywords: ["แอร์", "air", "เครื่องปรับอากาศ"] },
  { key: "termite", label: "🐛 ฉีดปลวก", keywords: ["ปลวก", "termite"] },
  { key: "pool", label: "🏊 สระว่ายน้ำ", keywords: ["สระ", "pool", "สระว่ายน้ำ"] },
] as const;

function daysUntil(due: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** สรุปอุปกรณ์ทุกหลัง — port จาก equipment_overview_screen.dart */
export default async function EquipmentOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.pmView)) redirect("/");
  const orgId = session.orgId;
  const { type } = await searchParams;
  const selected = TYPES.find((t) => t.key === type) ?? TYPES[0];

  const [schedules, properties, assets] = await Promise.all([
    listPmSchedules(orgId),
    listProperties(orgId),
    listAssets(orgId),
  ]);
  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const assetNames: Record<string, string> = Object.fromEntries(
    assets.map((a) => [a.id, a.name])
  );

  const filtered = schedules
    .filter((s) => {
      const title = s.title.toLowerCase();
      const asset = (s.assetId ? (assetNames[s.assetId] ?? "") : "").toLowerCase();
      return selected.keywords.some(
        (kw) => title.includes(kw.toLowerCase()) || asset.includes(kw.toLowerCase())
      );
    })
    .sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime());

  const byProperty = new Map<string, typeof filtered>();
  for (const s of filtered) {
    if (!byProperty.has(s.propertyId)) byProperty.set(s.propertyId, []);
    byProperty.get(s.propertyId)!.push(s);
  }

  return (
    <AppScaffold
      title="สรุปอุปกรณ์ทุกหลัง"
      width="max-w-3xl"
      backHref="/maintenance/pm"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <ChipLink
            key={t.key}
            href={`/maintenance/equipment-overview?type=${t.key}`}
            active={selected.key === t.key}
          >
            {t.label}
          </ChipLink>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ไม่พบ PM ประเภทนี้
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {Array.from(byProperty.entries()).map(([pid, items]) => (
            <Card key={pid} className="p-3">
              <p className="mb-2 text-base font-bold text-(--ink)">
                {propNames[pid] ?? pid}
              </p>
              {items.map((s) => {
                const left = daysUntil(s.nextDueDate);
                const overdue = left < 0;
                const dueSoon = !overdue && left <= 14;
                const color = overdue ? "#DC2626" : dueSoon ? "#EA580C" : "#16A34A";
                const label = overdue
                  ? `เกินกำหนด ${-left} วัน`
                  : `อีก ${left} วัน`;
                const assetName = s.assetId ? assetNames[s.assetId] : null;
                return (
                  <div key={s.id} className="mb-2 flex items-start gap-2">
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-(--ink)">
                        {assetName ? `${s.title} (${assetName})` : s.title}
                      </p>
                      <p className="text-xs text-(--ink-soft)">
                        ครบกำหนด: {fmtThaiDate(s.nextDueDate)} | ทำล่าสุด:{" "}
                        {s.lastCompletedDate
                          ? fmtThaiDate(s.lastCompletedDate)
                          : "ยังไม่เคยทำ"}
                      </p>
                      <p className="text-xs text-(--ink-soft)">
                        ความถี่: {freqLabel(s.frequency)}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        color,
                        backgroundColor: `${color}26`,
                        border: `1px solid ${color}66`,
                      }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
