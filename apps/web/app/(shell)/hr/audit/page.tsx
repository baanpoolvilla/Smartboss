import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, type AuditEvent, type Paged } from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  Td,
} from "@/modules/hr/components/ui";
import { formatDateTime } from "@/modules/hr/lib/labels";

export default async function HrAuditPage() {
  return (
    <HrPage
      title="ประวัติการใช้งาน"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const events = await wfFetch<Paged<AuditEvent>>("/audit-events");

        if (events.items.length === 0) {
          return <EmptyState>ยังไม่มีประวัติการใช้งาน</EmptyState>;
        }

        return (
          <>
            <p className="mb-3 text-sm text-(--ink-soft)">
              บันทึกเป็นแบบ append-only — แก้หรือลบไม่ได้ทั้งจาก API และ DB
            </p>

            <DataTable head={["เวลา", "การกระทำ", "ประเภท", "รายการ", "ผล"]}>
              {events.items.map((event) => (
                <tr key={event.id} className="hover:bg-(--bg-soft)">
                  <Td className="whitespace-nowrap text-xs">
                    {formatDateTime(event.occurred_at)}
                  </Td>
                  <Td className="font-mono text-xs">{event.action}</Td>
                  <Td>{event.resource_type}</Td>
                  <Td className="font-mono text-xs text-(--ink-soft)">
                    {event.resource_id ? event.resource_id.slice(0, 8) : "—"}
                  </Td>
                  <Td>
                    <StatusBadge value={event.outcome} />
                  </Td>
                </tr>
              ))}
            </DataTable>
          </>
        );
      }}
    />
  );
}
