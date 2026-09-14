import Link from "next/link";
import type { OrgSession } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import {
  DataTable,
  EmptyState,
  Field,
  Pill,
  SectionCard,
  StatCard,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import { gradeColor } from "@/lib/performance";
import { monthDisplay, monthKey, shiftMonth } from "@/lib/performance-month";
import { formatSatang } from "@/modules/hr/lib/commission";
import { loadCommissionMonth } from "@/modules/hr/lib/commission-data";
import { saveCommissionPoolAction, saveCommissionWeightsAction } from "../actions";

/**
 * แท็บ "ค่าคอม" ของหน้าพนักงาน — Pool รวมของบริษัทต่อเดือน แบ่งตามตัวคูณของเกรดเดือนเดียวกัน
 * แสดงผลอย่างเดียว ยังไม่เข้างวดเงินเดือน
 */
export async function renderCommissionTab(
  session: OrgSession,
  month: string,
  canManage: boolean,
): Promise<React.ReactNode> {
  const data = await loadCommissionMonth(session.orgId, month);
  const { split, gradeOrder, weights, pool } = data;

  const thisMonth = monthKey(new Date());
  const isCurrent = month === thisMonth;
  const rankOrder = gradeOrder.filter((g) => g !== "F");

  const receiving = split.shares.filter((s) => s.amountSatang > 0).length;
  const countByGrade = new Map<string, number>();
  for (const s of split.shares) countByGrade.set(s.grade, (countByGrade.get(s.grade) ?? 0) + 1);

  const perPersonOf = (grade: string) =>
    split.perUnitSatang === null ? null : Math.round(split.perUnitSatang * (weights[grade] ?? 0));

  const rows = [...split.shares].sort(
    (a, b) => b.amountSatang - a.amountSatang || b.score - a.score || a.name.localeCompare(b.name, "th"),
  );

  const monthLink = (m: string) => `/hr/employees?tab=commission&month=${m}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={monthLink(shiftMonth(month, -1))}>
          <Button size="sm" variant="outline" aria-label="เดือนก่อน">
            ‹
          </Button>
        </Link>
        <span className="min-w-28 text-center text-sm font-semibold text-(--ink)">
          ค่าคอม {monthDisplay(month)}
        </span>
        {isCurrent ? (
          <Button size="sm" variant="outline" disabled aria-label="เดือนถัดไป">
            ›
          </Button>
        ) : (
          <Link href={monthLink(shiftMonth(month, 1))}>
            <Button size="sm" variant="outline" aria-label="เดือนถัดไป">
              ›
            </Button>
          </Link>
        )}
        {!isCurrent && (
          <Link href={monthLink(thisMonth)} className="text-xs text-(--app-strong) hover:underline">
            กลับเดือนนี้
          </Link>
        )}
      </div>

      {isCurrent && (
        <p className="rounded-(--radius) border border-(--tone-warn)/35 bg-(--tone-warn)/10 px-3 py-2 text-xs text-(--ink)">
          เดือนนี้ยังไม่จบ — เกรดยังเปลี่ยนได้จนสิ้นเดือน ยอดค่าคอมของแต่ละคนจึงยังไม่ใช่ยอดสุดท้าย
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Pool รวม"
          value={pool === null ? "—" : formatSatang(pool.satang)}
          hint={pool === null ? "ยังไม่ได้ใส่ยอด" : "บาท"}
          tone={pool === null ? "var(--ink-soft)" : "var(--app-strong)"}
        />
        <StatCard label="ได้รับค่าคอม" value={`${receiving}/${split.shares.length}`} hint="คน" />
        <StatCard label="หน่วยรวม" value={split.totalUnits.toLocaleString("th-TH")} hint="ผลรวมตัวคูณทุกคน" />
        <StatCard
          label="เงินต่อหน่วย"
          value={split.perUnitSatang === null || pool === null ? "—" : formatSatang(Math.round(split.perUnitSatang))}
          hint="บาท ต่อตัวคูณ 1"
        />
      </div>

      {split.undistributedSatang > 0 && (
        <p className="rounded-(--radius) border border-(--danger)/35 bg-(--danger)/10 px-3 py-2 text-xs text-(--ink)">
          แจกค่าคอมไม่ออก {formatSatang(split.undistributedSatang)} บาท — ทุกคนได้เกรดที่ตัวคูณเป็น 0
          ปรับตัวคูณด้านล่างก่อน
        </p>
      )}

      {canManage && (
        <SectionCard
          title="ยอด Pool ของเดือนนี้"
          description="ยอดค่าคอมรวมของทั้งบริษัท — ระบบแบ่งให้ทุกคนตามตัวคูณของเกรดเดือนเดียวกัน · เว้นว่างแล้วบันทึก = ลบยอดของเดือนนี้"
        >
          <form action={saveCommissionPoolAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <input type="hidden" name="month" value={month} />
            <Field label="ยอด Pool (บาท)">
              <input
                id="commission-pool-amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={pool === null ? "" : (pool.satang / 100).toFixed(2)}
                className={inputClass}
              />
            </Field>
            <Field label="หมายเหตุ">
              <input
                id="commission-pool-note"
                name="note"
                maxLength={500}
                placeholder="เช่น ยอดขายรวม ก.ย. × 3%"
                defaultValue={pool?.note ?? ""}
                className={inputClass}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit">บันทึกยอด</Button>
            </div>
          </form>
        </SectionCard>
      )}

      <SectionCard
        title="ตัวคูณตามเกรด"
        description={
          data.weightsCustomized
            ? "ใช้ตัวคูณที่บริษัทตั้งไว้ — มีผลกับทุกเดือนที่เปิดดู"
            : "ยังไม่เคยตั้ง — ตอนนี้ใช้ค่าตั้งต้นไล่ลงตามอันดับเกรด"
        }
      >
        <form action={saveCommissionWeightsAction} className="flex flex-col gap-3">
          <DataTable head={["เกรด", "ตัวคูณ", "จำนวนคน", "ได้คนละ (บาท)"]}>
            {gradeOrder.map((grade) => {
              const perPerson = perPersonOf(grade);
              return (
                <tr key={grade} className="hover:bg-(--bg-soft)">
                  <Td>
                    <Pill tone={gradeColor(grade, rankOrder)}>{grade}</Pill>
                  </Td>
                  <Td>
                    <input type="hidden" name="gradeName" value={grade} />
                    {canManage ? (
                      <input
                        id={`commission-weight-${grade}`}
                        name="weight"
                        inputMode="decimal"
                        defaultValue={String(weights[grade] ?? 0)}
                        aria-label={`ตัวคูณของเกรด ${grade}`}
                        className={`${inputClass} h-9 w-24`}
                      />
                    ) : (
                      <span className="font-mono">{weights[grade] ?? 0}</span>
                    )}
                  </Td>
                  <Td align="right">{countByGrade.get(grade) ?? 0}</Td>
                  <Td align="right" className="font-mono">
                    {pool === null || perPerson === null ? "—" : formatSatang(perPerson)}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-(--ink-soft)">
                ตัวคูณ 0 = ไม่ได้ค่าคอม · ตัวอย่าง A = 1, B = 0.8 → คนเกรด B ได้ 80% ของคนเกรด A
              </p>
              <Button type="submit" size="sm" variant="outline">
                บันทึกตัวคูณ
              </Button>
            </div>
          )}
        </form>
      </SectionCard>

      <SectionCard
        title="ค่าคอมรายคน"
        description={
          data.eligibility === "registry"
            ? "พนักงานในทะเบียนที่ทำงานอยู่ในเดือนนี้ทุกคน · เกรดจากคะแนนผลงานของเดือนเดียวกัน"
            : "อ่านทะเบียนพนักงานไม่ได้ จึงแสดงผู้ใช้ที่เปิดใช้งานทุกคนแทน · เกรดจากคะแนนผลงานของเดือนเดียวกัน"
        }
      >
        {rows.length === 0 ? (
          <EmptyState>ยังไม่มีพนักงานที่มีคะแนนในเดือนนี้</EmptyState>
        ) : (
          <DataTable head={["พนักงาน", "เกรด", "คะแนน", "ตัวคูณ", "ค่าคอม (บาท)"]}>
            {rows.map((row) => (
              <tr key={row.userId} className="hover:bg-(--bg-soft)">
                <Td>
                  <span className="font-medium">{row.name}</span>
                  <span className="block truncate text-xs text-(--ink-soft)">{row.email}</span>
                </Td>
                <Td>
                  <Pill tone={gradeColor(row.grade, rankOrder)}>{row.grade}</Pill>
                </Td>
                <Td align="right" className="font-mono">
                  {row.score}
                </Td>
                <Td align="right" className="font-mono">
                  {row.weight}
                </Td>
                <Td align="right" className="font-mono font-medium">
                  {pool === null ? "—" : formatSatang(row.amountSatang)}
                </Td>
              </tr>
            ))}
            {pool !== null && (
              <tr className="border-t border-(--line)">
                <Td className="font-semibold">รวม</Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
                <Td align="right" className="font-mono">
                  {split.totalUnits}
                </Td>
                <Td align="right" className="font-mono font-semibold">
                  {formatSatang(rows.reduce((sum, r) => sum + r.amountSatang, 0))}
                </Td>
              </tr>
            )}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
