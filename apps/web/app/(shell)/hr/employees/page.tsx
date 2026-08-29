import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Fab } from "@/components/module/app-scaffold";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, wfTry, type Employment, type Paged, type Person } from "@/modules/hr/lib/api";
import { listOrgUsers } from "@/modules/admin/data/users";
import {
  ApiProblem,
  DataTable,
  EmptyState,
  Pill,
  StatusBadge,
  Td,
} from "@/modules/hr/components/ui";
import { employmentTypeLabel, formatDate } from "@/modules/hr/lib/labels";
import { buildScorecards } from "@/lib/performance";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; imported?: string }>;
}) {
  const { status, imported } = await searchParams;
  const session = await requireOrg();
  const canManage = hasPermission(session, HR_PERMS.employeeManage);

  return (
    <HrPage
      title="พนักงาน"
      permission={HR_PERMS.employeeView}
      fab={canManage ? <Fab href="/hr/employees/new" label="เพิ่มพนักงาน" /> : null}
      actions={
        canManage ? (
          <Link
            href="/hr/employees/import"
            className="text-sm text-(--app-strong) hover:underline"
          >
            นำเข้าจากผู้ใช้
          </Link>
        ) : null
      }
      load={async () => {
        const [data, people, users] = await Promise.all([
          wfFetch<Paged<Employment>>("/employments"),
          wfTry<Paged<Person>>("/people"),
          canManage ? listOrgUsers(session.orgId) : Promise.resolve([]),
        ]);
        const all = data.items;
        const rows = status ? all.filter((e) => e.status === status) : all;

        const statuses = Array.from(new Set(all.map((e) => e.status))).sort();

        /*
         * ทะเบียนพนักงานกับบัญชีผู้ใช้เป็นคนละชุดโดยตั้งใจ (บัญชี IT/ผู้ดูแล
         * ล็อกอินได้แต่ไม่ได้อยู่ในทะเบียนจ้างงาน) แต่เดิมไม่มีอะไรบอกเลยว่า
         * ยังมีคนตกค้าง — มีผู้ใช้ 14 คนแต่ทะเบียนมี 2 คน ก็ดูเหมือนปกติ
         * แล้วผลลงเวลาของอีก 12 คนจะหายไปเงียบ ๆ โดยไม่มีใครรู้
         *
         * จับคู่ด้วยอีเมล — ค่าเดียวที่ทั้งสองระบบมีและไม่ซ้ำ (ตัวเดียวกับที่
         * importEmployeesAction ใช้)
         */
        const employedPersonIds = new Set(all.map((e) => e.person_id));
        const registeredEmails = new Set(
          (people?.items ?? [])
            .filter((row) => row.email !== null && employedPersonIds.has(row.id))
            .map((row) => row.email!.toLowerCase()),
        );
        const missing = users.filter(
          (u) => u.isActive && !registeredEmails.has(u.email.toLowerCase()),
        ).length;

        /*
         * เกรดคิดจาก core.performance_events (งานซ่อมบำรุง + บอร์ดงาน + การลงเวลา)
         * ซึ่งผูกกับ core.users.id ส่วนทะเบียนจ้างงานอยู่ฝั่ง workforce —
         * จับคู่ด้วยอีเมล ค่าเดียวที่ทั้งสองระบบมีและไม่ซ้ำ
         *
         * ล้มแล้วไม่เป็นไร (คืน null) — เกรดเป็นข้อมูลเสริม ไม่ควรทำให้ทะเบียน
         * พนักงานเปิดไม่ได้
         */
        const now = new Date();
        const cards = await buildScorecards(
          session.orgId,
          new Date(now.getFullYear(), now.getMonth(), 1),
          now,
        ).catch(() => null);

        const emailOfPerson = new Map(
          (people?.items ?? [])
            .filter((row) => row.email !== null)
            .map((row) => [row.id, row.email!.toLowerCase()]),
        );
        const cardByEmail = new Map(
          (cards?.cards ?? []).map((c) => [c.email.toLowerCase(), c]),
        );
        const gradeOfEmployment = (personId: string) => {
          const mail = emailOfPerson.get(personId);
          return mail === undefined ? null : (cardByEmail.get(mail) ?? null);
        };

        return (
          <>
            {imported !== undefined && (
              <div className="mb-3">
                <ApiProblem heading={`นำเข้าพนักงานแล้ว ${imported} คน`} />
              </div>
            )}

            {missing > 0 && (
              <Link
                href="/hr/employees/import"
                className="mb-3 flex items-center justify-between gap-3 rounded-(--radius) border border-(--app) bg-(--app-pale) p-3 transition-colors hover:bg-(--app-soft)"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-(--ink)">
                    มีผู้ใช้อีก {missing} คนที่ยังไม่อยู่ในทะเบียนพนักงาน
                  </span>
                  <span className="mt-0.5 block text-xs text-(--ink-soft)">
                    คนที่ไม่อยู่ในทะเบียนจะลงเวลาและรับเงินเดือนไม่ได้ —
                    นำเข้าได้เลย ระบบเติมชื่อกับอีเมลให้แล้ว
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium text-(--app-strong)">
                  นำเข้า →
                </span>
              </Link>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link
                href="/hr/employees"
                className="rounded-full border px-3 py-1 text-xs transition-colors"
                style={
                  !status
                    ? {
                        color: "var(--app-strong)",
                        borderColor: "var(--app)",
                        backgroundColor: "var(--app-soft)",
                      }
                    : { color: "var(--ink-soft)", borderColor: "var(--line)" }
                }
              >
                ทั้งหมด ({all.length})
              </Link>
              {statuses.map((s) => (
                <Link
                  key={s}
                  href={`/hr/employees?status=${s}`}
                  className="rounded-full border px-3 py-1 text-xs transition-colors"
                  style={
                    status === s
                      ? {
                          color: "var(--app-strong)",
                          borderColor: "var(--app)",
                          backgroundColor: "var(--app-soft)",
                        }
                      : { color: "var(--ink-soft)", borderColor: "var(--line)" }
                  }
                >
                  {s} ({all.filter((e) => e.status === s).length})
                </Link>
              ))}
            </div>

            {rows.length === 0 ? (
              <EmptyState>
                {all.length === 0 && canManage ? (
                  <>
                    ยังไม่มีพนักงานในทะเบียน —{" "}
                    <Link
                      href="/hr/employees/import"
                      className="text-(--app-strong) hover:underline"
                    >
                      นำเข้าจากผู้ใช้ที่มีอยู่แล้ว
                    </Link>{" "}
                    หรือเพิ่มทีละคน
                  </>
                ) : (
                  "ไม่พบพนักงาน"
                )}
              </EmptyState>
            ) : (
              <DataTable
                head={[
                  "รหัส",
                  "ชื่อ-นามสกุล",
                  "ประเภทจ้าง",
                  "วันเริ่มงาน",
                  "เกรดเดือนนี้",
                  "สถานะ",
                  "",
                ]}
              >
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-(--bg-soft)">
                    <Td className="font-mono text-xs">{e.employee_code}</Td>
                    <Td>
                      <Link
                        href={`/hr/employees/${e.id}`}
                        className="font-medium hover:underline"
                      >
                        {e.full_name}
                      </Link>
                      {e.display_name !== e.full_name && (
                        <span className="ml-2 text-xs text-(--ink-soft)">
                          ({e.display_name})
                        </span>
                      )}
                    </Td>
                    <Td>{employmentTypeLabel(e.employment_type)}</Td>
                    <Td>{formatDate(e.hired_on)}</Td>
                    <Td>
                      {(() => {
                        const card = gradeOfEmployment(e.person_id);
                        if (card === null) return <span className="text-(--ink-soft)">—</span>;
                        return (
                          <span className="flex items-center gap-2">
                            <Pill
                              tone={
                                card.grade === "F" ? "var(--danger)" : "var(--tone-ok)"
                              }
                            >
                              {card.grade}
                            </Pill>
                            <span className="font-mono text-xs text-(--ink-soft)">
                              {card.score}
                            </span>
                          </span>
                        );
                      })()}
                    </Td>
                    <Td>
                      <StatusBadge value={e.status} />
                    </Td>
                    <Td align="right">
                      <Link href={`/hr/employees/${e.id}`}>
                        <ChevronRight className="inline h-4 w-4 text-(--ink-soft)" />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </>
        );
      }}
    />
  );
}
