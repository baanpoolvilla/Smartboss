import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Fab } from "@/components/module/app-scaffold";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, type Employment, type Paged } from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  Td,
} from "@/modules/hr/components/ui";
import { employmentTypeLabel, formatDate } from "@/modules/hr/lib/labels";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const session = await requireOrg();
  const canManage = hasPermission(session, HR_PERMS.employeeManage);

  return (
    <HrPage
      title="พนักงาน"
      permission={HR_PERMS.employeeView}
      fab={canManage ? <Fab href="/hr/employees/new" label="เพิ่มพนักงาน" /> : null}
      load={async () => {
        const data = await wfFetch<Paged<Employment>>("/employments");
        const all = data.items;
        const rows = status ? all.filter((e) => e.status === status) : all;

        const statuses = Array.from(new Set(all.map((e) => e.status))).sort();

        return (
          <>
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
              <EmptyState>ไม่พบพนักงาน</EmptyState>
            ) : (
              <DataTable
                head={["รหัส", "ชื่อ-นามสกุล", "ประเภทจ้าง", "วันเริ่มงาน", "สถานะ", ""]}
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
