import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, type Paged, type Payslip } from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Td,
} from "@/modules/hr/components/ui";
import { formatDate, formatMoney } from "@/modules/hr/lib/labels";

export default async function MyPayslipsPage() {
  return (
    <HrPage
      title="สลิปของฉัน"
      permission={HR_PERMS.access}
      width="max-w-3xl"
      load={async () => {
        const slips = await wfFetch<Paged<Payslip>>("/me/payslips");

        if (slips.items.length === 0) {
          return (
            <EmptyState>
              ยังไม่มีสลิปเงินเดือน — สลิปจะออกให้หลังงวดถูกล็อกและเผยแพร่แล้ว
            </EmptyState>
          );
        }

        return (
          <DataTable
            head={["วันที่ออก", "ฉบับที่", "เงินได้", "รายการหัก", "สุทธิ"]}
          >
            {slips.items.map((slip) => (
              <tr key={slip.id} className="hover:bg-(--bg-soft)">
                <Td>{formatDate(slip.published_at)}</Td>
                <Td align="center">v{slip.document_version}</Td>
                <Td align="right">{formatMoney(slip.gross)}</Td>
                <Td align="right" className="text-(--tone-danger)">
                  {formatMoney(slip.total_deduction)}
                </Td>
                <Td align="right" className="font-bold">
                  {formatMoney(slip.net_pay)} {slip.currency}
                </Td>
              </tr>
            ))}
          </DataTable>
        );
      }}
    />
  );
}
