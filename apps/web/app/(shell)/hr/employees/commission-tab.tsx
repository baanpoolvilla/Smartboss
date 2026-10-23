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
import { monthDisplay, shiftMonth } from "@/lib/performance-month";
import { scorePeriodOf } from "@/lib/score-period";
import { loadScorePeriodConfig, loadScorePeriodReadyAt } from "@/lib/score-period-config";
import { ScorePeriodStatus } from "@/components/score-period-status";
import { COMMISSION_METHODS, formatSatang } from "@/modules/hr/lib/commission";
import { commissionForUser, loadCommissionMonth } from "@/modules/hr/lib/commission-data";
import {
  saveCommissionEligibilityAction,
  saveCommissionMethodAction,
  saveCommissionPoolAction,
  saveCommissionValuesAction,
  saveCommissionWeightsAction,
} from "../actions";

/**
 * แท็บ "ค่าคอม" ของหน้าพนักงาน — บริษัทเลือกวิธีคิดเอง (Pool ÷ ตัวคูณ · % ของเงินเดือน · บาทต่อเกรด · ไม่คิดจากเกรด)
 * และเลือกคนที่ได้ (บางแผนก · ยกเว้นรายคน) · ยอดเข้างวดเงินเดือนเดือนเดียวกันอัตโนมัติ (โมดูลเงินเดือน)
 */
export async function renderCommissionTab(
  session: OrgSession,
  month: string,
  canManage: boolean,
): Promise<React.ReactNode> {
  const data = await loadCommissionMonth(session.orgId, month);
  const { split, gradeOrder, weights, pool, method, values, members, departments, eligibility } = data;

  // รอบเกรด (ตัดวันที่ 25 — score-period.ts) ไม่ใช่เดือนปฏิทิน
  const period = await loadScorePeriodConfig(session.orgId);
  const thisMonth = scorePeriodOf(period, new Date());
  const isCurrent = month === thisMonth;
  const readyAt = await loadScorePeriodReadyAt(session.orgId, period, month);
  const rankOrder = gradeOrder.filter((g) => g !== "F");
  const label = monthDisplay(month);

  const eligibleMembers = members.filter((m) => m.eligible);
  const countByGrade = new Map<string, number>();
  for (const m of eligibleMembers) countByGrade.set(m.grade, (countByGrade.get(m.grade) ?? 0) + 1);
  const perPersonOf = (grade: string) =>
    split.perUnitSatang === null ? null : Math.round(split.perUnitSatang * (weights[grade] ?? 0));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const rows = members
    .map((m) => ({ ...m, comm: commissionForUser(data, m.userId, label) }))
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        (b.comm?.kind === "amount" ? b.comm.satang : 0) - (a.comm?.kind === "amount" ? a.comm.satang : 0) ||
        b.score - a.score ||
        a.name.localeCompare(b.name, "th"),
    );
  const receiving = rows.filter((r) => r.comm !== null).length;
  const totalSatang = rows.reduce((sum, r) => sum + (r.comm?.kind === "amount" ? r.comm.satang : 0), 0);

  const monthLink = (m: string) => `/hr/employees?tab=commission&month=${m}`;
  const methodInfo = COMMISSION_METHODS.find((x) => x.id === method)!;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link prefetch={false} href={monthLink(shiftMonth(month, -1))}>
          <Button size="sm" variant="outline" aria-label="เดือนก่อน">
            ‹
          </Button>
        </Link>
        <span className="min-w-28 text-center text-sm font-semibold text-(--ink)">ค่าคอม {label}</span>
        {isCurrent ? (
          <Button size="sm" variant="outline" disabled aria-label="เดือนถัดไป">
            ›
          </Button>
        ) : (
          <Link prefetch={false} href={monthLink(shiftMonth(month, 1))}>
            <Button size="sm" variant="outline" aria-label="เดือนถัดไป">
              ›
            </Button>
          </Link>
        )}
        {!isCurrent && (
          <Link prefetch={false} href={monthLink(thisMonth)} className="text-xs text-(--app-strong) hover:underline">
            กลับเดือนนี้
          </Link>
        )}
      </div>

      {/* เกรดของเดือนนี้พร้อมใช้คำนวณเงินหรือยัง — ยอดค่าคอมเป็นยอดสุดท้ายเมื่อปิดรอบแล้ว */}
      {method !== "off" && <ScorePeriodStatus period={period} month={month} readyAt={readyAt} />}

      <SectionCard title="วิธีคิดค่าคอม" description="ตั้งครั้งเดียว ใช้ทุกเดือน · ยอดของแต่ละคนเข้างวดเงินเดือนเดือนเดียวกันเอง (แก้รายคนได้ในงวดเงินเดือน)">
        {canManage ? (
          <form action={saveCommissionMethodAction} className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="วิธีคิดค่าคอม" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {COMMISSION_METHODS.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-start gap-3 rounded-(--radius) border border-(--line) p-3 has-[:checked]:border-(--brand-navy) has-[:checked]:bg-(--bg-soft)"
                >
                  <input type="radio" name="method" value={m.id} defaultChecked={m.id === method} className="mt-1 h-4 w-4" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-(--ink)">{m.label}</span>
                    <span className="text-xs text-(--ink-soft)">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                บันทึกวิธีคิด
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-(--ink)">
            {methodInfo.label} — <span className="text-(--ink-soft)">{methodInfo.hint}</span>
          </p>
        )}
      </SectionCard>

      {method === "off" ? (
        <p className="rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm text-(--ink)">
          ไม่คิดค่าคอมจากเกรด — ถ้าเดือนไหนมีค่าคอม ให้ใส่เองรายคนในงวดเงินเดือน (แก้ไข › รายการปรับเพิ่ม › คอมมิชชั่น)
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {method === "pool" ? (
              <StatCard
                label="Pool รวม"
                value={pool === null ? "—" : formatSatang(pool.satang)}
                hint={pool === null ? "ยังไม่ได้ใส่ยอด" : "บาท"}
                tone={pool === null ? "var(--ink-soft)" : "var(--app-strong)"}
              />
            ) : (
              <StatCard label="วิธีคิด" value={method === "percent" ? "% เงินเดือน" : "บาทต่อเกรด"} hint="ตั้งไว้ด้านบน" />
            )}
            <StatCard label="ได้รับค่าคอม" value={`${receiving}/${members.length}`} hint="คน" />
            {method === "pool" ? (
              <>
                <StatCard label="หน่วยรวม" value={split.totalUnits.toLocaleString("th-TH")} hint="ผลรวมตัวคูณคนที่ได้" />
                <StatCard
                  label="เงินต่อหน่วย"
                  value={split.perUnitSatang === null || pool === null ? "—" : formatSatang(Math.round(split.perUnitSatang))}
                  hint="บาท ต่อตัวคูณ 1"
                />
              </>
            ) : (
              <StatCard
                label="รวมทั้งเดือน"
                value={method === "fixed" ? formatSatang(totalSatang) : "—"}
                hint={method === "fixed" ? "บาท" : "คิดจากเงินเดือนในงวดเงินเดือน"}
              />
            )}
          </div>

          {method === "pool" && split.undistributedSatang > 0 && (
            <p className="rounded-(--radius) border border-(--danger)/35 bg-(--danger)/10 px-3 py-2 text-xs text-(--ink)">
              แจกค่าคอมไม่ออก {formatSatang(split.undistributedSatang)} บาท — ทุกคนได้เกรดที่ตัวคูณเป็น 0 ปรับตัวคูณด้านล่างก่อน
            </p>
          )}

          {method === "pool" && canManage && (
            <SectionCard
              title="ยอด Pool ของเดือนนี้"
              description="ยอดค่าคอมรวมของทั้งบริษัท — ระบบแบ่งให้คนที่ได้ค่าคอมตามตัวคูณของเกรดเดือนเดียวกัน · เว้นว่างแล้วบันทึก = ลบยอดของเดือนนี้"
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

          {method === "pool" ? (
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
                    <p className="text-xs text-(--ink-soft)">ตัวคูณ 0 = ไม่ได้ค่าคอม · ตัวอย่าง A = 1, B = 0.8 → คนเกรด B ได้ 80% ของคนเกรด A</p>
                    <Button type="submit" size="sm" variant="outline">
                      บันทึกตัวคูณ
                    </Button>
                  </div>
                )}
              </form>
            </SectionCard>
          ) : (
            <SectionCard
              title={method === "percent" ? "% ของเงินเดือน ตามเกรด" : "จำนวนเงิน ตามเกรด"}
              description={method === "percent" ? "เช่น A = 10 → คนเกรด A เงินเดือน 20,000 ได้ค่าคอม 2,000 · 0 = ไม่ได้" : "ทุกคนในเกรดเดียวกันได้เท่ากัน · 0 = ไม่ได้"}
            >
              <form action={saveCommissionValuesAction} className="flex flex-col gap-3">
                <DataTable head={["เกรด", method === "percent" ? "% ของเงินเดือน" : "บาทต่อคน", "จำนวนคน"]}>
                  {gradeOrder.map((grade) => (
                    <tr key={grade} className="hover:bg-(--bg-soft)">
                      <Td>
                        <Pill tone={gradeColor(grade, rankOrder)}>{grade}</Pill>
                      </Td>
                      <Td>
                        <input type="hidden" name="gradeName" value={grade} />
                        {canManage ? (
                          <input
                            id={`commission-value-${grade}`}
                            name="value"
                            inputMode="decimal"
                            defaultValue={String(values[grade] ?? 0)}
                            aria-label={`${method === "percent" ? "% ของเงินเดือน" : "จำนวนเงิน"} ของเกรด ${grade}`}
                            className={`${inputClass} h-9 w-32`}
                          />
                        ) : (
                          <span className="font-mono">{values[grade] ?? 0}</span>
                        )}
                      </Td>
                      <Td align="right">{countByGrade.get(grade) ?? 0}</Td>
                    </tr>
                  ))}
                </DataTable>
                {canManage && (
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" variant="outline">
                      บันทึก
                    </Button>
                  </div>
                )}
              </form>
            </SectionCard>
          )}

          <SectionCard
            title="ใครได้ค่าคอม"
            description={
              data.registry === "registry"
                ? "พนักงานในทะเบียนที่ทำงานอยู่ในเดือนนี้ · เกรดจากคะแนนผลงานของเดือนเดียวกัน"
                : "อ่านทะเบียนพนักงานไม่ได้ จึงแสดงผู้ใช้ที่เปิดใช้งานทุกคนแทน · เกรดจากคะแนนผลงานของเดือนเดียวกัน"
            }
          >
            <form action={saveCommissionEligibilityAction} className="flex flex-col gap-4">
              {departments.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-semibold text-(--ink)">เฉพาะแผนก (ไม่ติ๊กเลย = ทุกแผนก)</legend>
                  <div className="flex flex-wrap gap-2">
                    {departments.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 rounded-full border border-(--line) px-3 py-1.5 text-sm has-[:checked]:border-(--brand-navy) has-[:checked]:bg-(--bg-soft)">
                        <input type="checkbox" name="departmentId" value={d.id} defaultChecked={eligibility.departmentIds.includes(d.id)} disabled={!canManage} className="h-4 w-4" />
                        {d.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {rows.length === 0 ? (
                <EmptyState>ยังไม่มีพนักงานที่มีคะแนนในเดือนนี้</EmptyState>
              ) : (
                <DataTable head={["พนักงาน", "เกรด", "คะแนน", "ค่าคอมเดือนนี้", ...(canManage ? ["ไม่ให้ค่าคอม"] : [])]}>
                  {rows.map((row) => (
                    <tr key={row.userId} className={row.eligible ? "hover:bg-(--bg-soft)" : "bg-(--bg-soft) text-(--ink-soft)"}>
                      <Td>
                        <span className="font-medium">{row.name}</span>
                        <span className="block truncate text-xs text-(--ink-soft)">
                          {[row.departmentId ? deptName.get(row.departmentId) : null, row.email].filter(Boolean).join(" · ")}
                        </span>
                      </Td>
                      <Td>
                        <Pill tone={gradeColor(row.grade, rankOrder)}>{row.grade}</Pill>
                      </Td>
                      <Td align="right" className="font-mono">
                        {row.score}
                      </Td>
                      <Td align="right" className="font-mono font-medium">
                        {!row.eligible
                          ? eligibility.excludedUserIds.includes(row.userId)
                            ? "ไม่ให้ (ยกเว้น)"
                            : "ไม่ได้ (นอกแผนกที่เลือก)"
                          : row.comm === null
                            ? "—"
                            : row.comm.kind === "amount"
                              ? formatSatang(row.comm.satang)
                              : `${row.comm.percent}% ของเงินเดือน`}
                      </Td>
                      {canManage && (
                        <Td align="center">
                          <input
                            type="checkbox"
                            name="excludedUserId"
                            value={row.userId}
                            defaultChecked={eligibility.excludedUserIds.includes(row.userId)}
                            aria-label={`ไม่ให้ค่าคอม ${row.name}`}
                            className="h-4 w-4"
                          />
                        </Td>
                      )}
                    </tr>
                  ))}
                  {method !== "percent" && receiving > 0 && (
                    <tr className="border-t border-(--line)">
                      <Td className="font-semibold">รวม</Td>
                      <Td>{""}</Td>
                      <Td>{""}</Td>
                      <Td align="right" className="font-mono font-semibold">
                        {formatSatang(totalSatang)}
                      </Td>
                      {canManage && <Td>{""}</Td>}
                    </tr>
                  )}
                </DataTable>
              )}
              {canManage && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-(--ink-soft)">เช่น คนทดลองงานไม่ได้ค่าคอม → ติ๊ก &quot;ไม่ให้ค่าคอม&quot; · มีผลทุกเดือนจนกว่าจะเอาออก</p>
                  <Button type="submit" size="sm" variant="outline">
                    บันทึกคนที่ได้ค่าคอม
                  </Button>
                </div>
              )}
            </form>
          </SectionCard>
        </>
      )}
    </div>
  );
}
