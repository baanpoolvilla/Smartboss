import { loadPerformanceSettings } from "@/lib/performance";
import { PmRulesNote } from "@/modules/maintenance/components/pm-rules-note";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  Pencil,
  Plus,
  ShieldCheck,
  ShieldAlert,
  CalendarClock,
  ClipboardList,
} from "lucide-react";
import { requireOrg, hasPermission, canViewAll } from "@smartboss/auth";
import { canEditDueDate } from "@/modules/maintenance/lib/due-request-access";
import { prisma } from "@smartboss/database";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { getAsset, lastMaintenanceDates } from "@/modules/maintenance/data/assets";
import { getProperty } from "@/modules/maintenance/data/properties";
import { listPmForAsset } from "@/modules/maintenance/data/pm";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import { freqLabel, PM_FREQUENCIES } from "@/modules/maintenance/lib/pm-schedule";
import { toDateInput } from "@/modules/maintenance/lib/format";
import { todayBangkok } from "@/modules/maintenance/lib/no-past-date";
import { updateAssetAction, deleteAssetAction } from "../actions";
import { deletePmAction, updatePmAction } from "../../pm/actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { PasteDropFiles } from "@/components/annotate/paste-drop-files";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}
function dateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-(--ink-soft)">{label}</span>
      <span className="text-right font-medium text-(--ink)">{value}</span>
    </div>
  );
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.assetView)) redirect("/");
  const orgId = session.orgId;

  const asset = await getAsset(orgId, id);
  if (!asset) notFound();

  const canManage = hasPermission(session, MAINT_PERMS.assetManage);
  const canManagePm = hasPermission(session, MAINT_PERMS.pmManage);
  const perf = await loadPerformanceSettings(session.orgId);
  const [property, lastMap, schedules, users] = await Promise.all([
    getProperty(orgId, asset.propertyId),
    lastMaintenanceDates(orgId, [id]),
    listPmForAsset(orgId, id),
    canManagePm ? listOrgUsers(orgId) : Promise.resolve([]),
  ]);
  const today = todayBangkok();
  // ใบงานที่เปิดค้างของแต่ละแผน (เหมือนหน้าปฏิทิน PM) — รอบของแผนเดินต่อเมื่อปิดใบนี้ ไม่ใช่ตอนสร้างใบ
  // เดิมหน้านี้ไม่บอก ⇒ สร้างใบแล้วยังขึ้น "เกินกำหนด" กับปุ่มสร้างใบงานเหมือนยังไม่มีใคร ("ทำไมสร้างใบงานไปแล้ว…")
  const pmIds = schedules.map((s) => s.id);
  const pendingWos = pmIds.length
    ? await prisma.workOrder.findMany({
        where: {
          orgId,
          status: { in: ["open", "in_progress"] },
          OR: [{ pmScheduleId: { in: pmIds } }, { pmScheduleIds: { hasSome: pmIds } }],
        },
        select: { id: true, code: true, status: true, pmScheduleId: true, pmScheduleIds: true, pmRoundDate: true, dueDate: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const pending = new Map<string, (typeof pendingWos)[number]>();
  for (const w of [...pendingWos].reverse()) {
    if (w.pmScheduleId) pending.set(w.pmScheduleId, w);
    for (const pid of w.pmScheduleIds) pending.set(pid, w);
  }
  // ใบที่เปิดค้างทั้งหมดของแต่ละแผน เรียงตามวันครบกำหนด — แผนรอบสั้นมีได้หลายใบพร้อมกัน
  // nextDueDate คือรอบถัดไปที่ยังไม่เปิดใบ ถ้าโชว์เป็น "ครบกำหนด" จะดูเหมือนวันที่เลือกเด้งไปไกล (ผู้ใช้ 4/11/2569)
  const openWosOf = (pid: string) =>
    pendingWos
      .filter((w) => w.pmScheduleId === pid || w.pmScheduleIds.includes(pid))
      .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
  const warrantyExpired =
    asset.warrantyExpiry != null && asset.warrantyExpiry < new Date();

  return (
    <AppScaffold
      title={asset.name}
      width="max-w-none"
      backHref={
        property ? `/maintenance/properties/${property.id}` : "/maintenance/assets"
      }
    >
      <header className="mb-4 flex items-start justify-end gap-3">
        {canManage && (
          <form action={deleteAssetAction}>
            <input type="hidden" name="id" value={id} />
            <input
              type="hidden"
              name="back"
              value={property ? `/maintenance/properties/${property.id}` : "/maintenance/assets"}
            />
            <Button type="submit" variant="ghost" size="sm">
              ลบอุปกรณ์
            </Button>
          </form>
        )}
      </header>

      {asset.imageUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={asset.imageUrl}
          alt={asset.name}
          className="mb-4 h-[200px] w-full rounded-xl object-cover"
        />
      )}

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-semibold text-(--ink)">ข้อมูลอุปกรณ์</h2>
        <InfoRow label="บ้าน" value={property?.name ?? "-"} />
        <InfoRow label="หมวด" value={asset.category || "-"} />
        <InfoRow label="ยี่ห้อ" value={asset.brand || "-"} />
        <InfoRow label="รุ่น" value={asset.model || "-"} />
        <InfoRow label="วันติดตั้ง" value={fmtDate(asset.installDate)} />
        <div className="flex justify-between gap-4 py-1.5 text-sm">
          <span className="text-(--ink-soft)">ประกัน</span>
          <span
            className="inline-flex items-center gap-1 text-right font-medium"
            style={{ color: warrantyExpired ? "#DC2626" : "var(--ink)" }}
          >
            {asset.warrantyExpiry ? (
              <>
                {warrantyExpired ? (
                  <ShieldAlert className="h-4 w-4" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {fmtDate(asset.warrantyExpiry)}
                {warrantyExpired ? " (หมดแล้ว)" : ""}
              </>
            ) : (
              "-"
            )}
          </span>
        </div>
        {asset.notes && <InfoRow label="หมายเหตุ" value={asset.notes} />}
        <InfoRow label="ซ่อมบำรุงล่าสุด" value={fmtDate(lastMap[id])} />
      </Card>

      {canManage && (
        <details className="mb-6">
          <summary className="mb-2 inline-flex cursor-pointer items-center gap-1 text-sm text-(--brand-green)">
            <Pencil className="h-4 w-4" /> แก้ไขอุปกรณ์
          </summary>
          <Card className="p-4">
            <PasteDropFiles label="ปล่อยเพื่อแนบรูป">
            <form
              action={updateAssetAction.bind(null, id)}
              className="flex flex-col gap-3"
            >
              <Input name="name" defaultValue={asset.name} required />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input name="category" defaultValue={asset.category ?? ""} placeholder="หมวด" />
                <Input name="brand" defaultValue={asset.brand ?? ""} placeholder="ยี่ห้อ" />
                <Input name="model" defaultValue={asset.model ?? ""} placeholder="รุ่น" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs text-(--ink-soft)">
                  วันติดตั้ง
                  <Input name="installDate" type="date" defaultValue={dateInput(asset.installDate)} className="mt-1" />
                </label>
                <label className="text-xs text-(--ink-soft)">
                  ประกันหมดอายุ
                  <Input name="warrantyExpiry" type="date" defaultValue={dateInput(asset.warrantyExpiry)} className="mt-1" />
                </label>
              </div>
              <Input name="notes" defaultValue={asset.notes ?? ""} placeholder="หมายเหตุ" />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-(--ink-soft)">
                  เปลี่ยนรูปอุปกรณ์ (ไม่เลือก = ใช้รูปเดิม)
                </span>
                <input
                  type="file"
                  name="image"
                  accept="image/*"
                  className="text-sm text-(--ink) file:mr-3 file:rounded-(--radius) file:border file:border-(--line) file:bg-(--bg-soft) file:px-3 file:py-1.5 file:text-sm"
                />
              </label>
              <Button type="submit" className="sm:w-40">บันทึก</Button>
            </form>
            </PasteDropFiles>
          </Card>
        </details>
      )}

      <PmRulesNote points={perf.rulePoints.pm_missed} leadDays={perf.pmLeadDays} className="mb-3" />
      {/* แผน PM ของอุปกรณ์นี้ */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-(--ink)">
          แผน PM ({schedules.length})
        </h2>
        {canManagePm && (
          <Link
            href={`/maintenance/pm/new?assetId=${id}&propertyId=${asset.propertyId}`}
          >
            <Button
              type="button"
              size="sm"
              className="gap-1 bg-[#CCFBF1] text-[#0F766E] hover:brightness-95"
            >
              <Plus className="h-4 w-4" /> เพิ่ม PM
            </Button>
          </Link>
        )}
      </div>
      {schedules.length === 0 ? (
        <Card className="p-8 text-center text-sm text-(--ink-soft)">
          <CalendarClock className="mx-auto mb-2 h-12 w-12 opacity-40" />
          ยังไม่มีแผน PM
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {schedules.map((s) => {
            const left = Math.round(
              (new Date(s.nextDueDate).setHours(0, 0, 0, 0) -
                new Date().setHours(0, 0, 0, 0)) /
                86_400_000
            );
            const overdue = left < 0;
            const dueSoon = left >= 0 && left <= 7;
            const color = overdue ? "#DC2626" : dueSoon ? "#EA580C" : "#0D9488";
            const statusText = overdue
              ? `เกินกำหนด ${-left} วัน`
              : `${left} วัน`;
            const openWo = pending.get(s.id);
            const openWos = openWosOf(s.id);
            const firstDue = openWos[0]?.dueDate ?? null;
            // มีใบงานแล้ว: ป้ายขวาบอก "สร้างใบงานแล้ว · รอปิดงาน" (กรมท่า) แทนป้ายนับวัน — ผู้ดูแลบ้านเห็นป้ายแดง
            // "เกินกำหนด" ทั้งที่สร้างใบไปแล้วจะงง (ผู้ใช้ 3/11/2569) · ส่วนเลยกำหนดย้ายไปบอกในแถวใบงาน
            const pillColor = openWo ? "var(--brand-navy)" : color;
            return (
              <Card key={s.id} className="p-3">
                <div className="flex items-start gap-3">
                  <CalendarClock
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: pillColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-(--ink)">
                      {s.title}
                    </p>
                    <p className="truncate text-xs text-(--ink-soft)">
                      ทุก {freqLabel(s.frequency)} • ครบกำหนด{" "}
                      {fmtDate(firstDue ?? s.nextDueDate)}
                      {firstDue && ` • รอบถัดไป ${fmtDate(s.nextDueDate)}`}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold"
                    style={
                      openWo
                        ? { color: "var(--brand-navy)", backgroundColor: "color-mix(in srgb, var(--brand-navy) 10%, transparent)" }
                        : { color, backgroundColor: `${color}1a` }
                    }
                  >
                    {openWo ? "สร้างใบงานแล้ว · รอปิดงาน" : statusText}
                  </span>
                </div>
                {openWos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {openWos.map((w) => {
                      const lateDays = w.dueDate
                        ? Math.floor((Date.now() - w.dueDate.getTime()) / 86_400_000) + 1
                        : overdue ? -left : 0;
                      return (
                        <Link
                          key={w.id}
                          href={`/maintenance/work-orders/${w.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-(--bg-soft) px-2.5 py-1 text-xs text-(--ink) hover:underline"
                        >
                          <ClipboardList className="h-3.5 w-3.5 text-(--ink-soft)" />
                          ใบงาน {w.code}
                          {w.dueDate && ` · ครบกำหนด ${fmtDate(w.dueDate)}`} · {w.status === "in_progress" ? "กำลังดำเนินการ" : "รอรับงาน"}
                          {lateDays > 0 && <span className="text-[#DC2626]">· เลยกำหนด {lateDays} วัน</span>}
                          <span className="text-(--ink-soft)">· ดูใบงาน →</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
                {canManagePm && (
                  <PmEditForm
                    s={s}
                    users={users}
                    today={today}
                    openRoundLabels={openWos.filter((w) => w.pmRoundDate).map((w) => fmtDate(w.pmRoundDate))}
                    firstOpenRound={[...openWos].filter((w) => w.pmRoundDate).sort((a, b) => a.pmRoundDate!.getTime() - b.pmRoundDate!.getTime())[0]?.pmRoundDate ?? null}
                    canMoveRounds={canEditDueDate({ userId: session.userId, viewAll: canViewAll(session) }, { createdBy: s.createdBy })}
                  />
                )}
                {canManagePm && (
                  <div className="mt-2 flex items-center gap-2">
                    {!openWo && (
                    <Link
                      href={`/maintenance/work-orders/new?pmScheduleId=${s.id}&assetId=${id}&propertyId=${s.propertyId}&title=${encodeURIComponent(s.title)}`}
                    >
                      <Button type="button" size="sm" variant="outline" className="gap-1">
                        <Plus className="h-3.5 w-3.5" /> สร้างใบงาน
                      </Button>
                    </Link>
                    )}
                    <form action={deletePmAction} className="ml-auto">
                      <input type="hidden" name="id" value={s.id} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        className="text-[#DC2626]"
                      >
                        ลบ
                      </Button>
                    </form>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}

const fieldClass = "h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";

/**
 * แก้แผน PM ตรงหน้าอุปกรณ์ (ผู้ใช้ 3/11/2569 "อยากให้แก้ไขตั้งค่าตรงนี้ได้") — ช่องเดียวกับ "แก้ไข PM"
 * บนปฏิทิน PM ส่งเข้า updatePmAction ตัวเดิม (กติกาเดิมทั้งหมด: วันย้อนหลังไม่ได้, ต้องมีผู้รับผิดชอบ,
 * originalNextDueDate กันวันเก่าทับ)
 */
function PmEditForm({
  s,
  users,
  today,
  openRoundLabels,
  firstOpenRound,
  canMoveRounds,
}: {
  s: { id: string; title: string; frequency: string; nextDueDate: Date; assignedTo: string | null; requiresExpense: boolean; description: string | null };
  users: { id: string; name: string }[];
  today: string;
  openRoundLabels: string[];
  firstOpenRound: Date | null;
  canMoveRounds: boolean;
}) {
  // มีใบเปิดอยู่ ช่องนี้คือวันครบกำหนดของใบนั้น ไม่ใช่รอบถัดไปที่ยังไม่เปิด
  const due = toDateInput(firstOpenRound ?? s.nextDueDate);
  const locked = !!firstOpenRound && !canMoveRounds;
  return (
    <details className="mt-2">
      <summary className="inline-flex cursor-pointer items-center gap-1 text-xs text-(--brand-green)">
        <Pencil className="h-3.5 w-3.5" /> แก้ไขแผน PM
      </summary>
      <form action={updatePmAction} className="mt-2 grid grid-cols-1 gap-3 rounded-(--radius) border border-(--line) p-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={s.id} />
        <input type="hidden" name="originalNextDueDate" value={due} />
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft) sm:col-span-2">
          ชื่องาน PM
          <input name="title" defaultValue={s.title} required className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          ความถี่
          <select name="frequency" defaultValue={s.frequency} className={fieldClass}>
            {PM_FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          {firstOpenRound ? "ครบกำหนดรอบนี้" : "วันกำหนดถัดไป"}
          <input type="date" name="nextDueDate" defaultValue={due} min={due < today ? due : today} disabled={locked} className={fieldClass} />
          {openRoundLabels.length > 0 && (
            <span data-testid="pm-open-rounds-hint">{locked ? `ใบรอบ ${openRoundLabels.join(", ")} เปิดอยู่ แก้วันที่ได้เฉพาะคนสร้างแผนหรือผู้ดูแล ถ้าทำไม่ทันให้กดขอเลื่อนในใบงาน` : `ใบรอบ ${openRoundLabels.join(", ")} เปิดอยู่ เปลี่ยนวันแล้วใบเลื่อนตาม รอบต่อไปนับจากวันที่เลือก`}</span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft) sm:col-span-2">
          ผู้รับผิดชอบ *
          <select name="assignedTo" required defaultValue={s.assignedTo ?? ""} className={fieldClass}>
            <option value="" disabled>— เลือกผู้รับผิดชอบ —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2.5 rounded-(--radius) border border-(--line) p-2.5 sm:col-span-2">
          <input type="checkbox" name="noExpense" value="1" defaultChecked={!s.requiresExpense} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="block text-sm font-medium text-(--ink)">แผนนี้ไม่มีค่าใช้จ่าย</span>
            <span className="block text-xs text-(--ink-soft)">มีผลกับใบงานที่ระบบสร้างหลังจากนี้ ใบที่เปิดค้างอยู่ไม่เปลี่ยนตาม</span>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft) sm:col-span-2">
          รายละเอียด
          <textarea name="description" rows={2} defaultValue={s.description ?? ""} className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)" />
        </label>
        <Button type="submit" size="sm" className="sm:w-32">บันทึก</Button>
      </form>
    </details>
  );
}
