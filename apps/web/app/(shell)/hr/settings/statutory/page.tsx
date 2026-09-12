import { Info } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, type Paged, type StatutoryRuleSet } from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  Td,
} from "@/modules/hr/components/ui";
import { formatDate, ruleTypeLabel } from "@/modules/hr/lib/labels";

export default async function StatutoryPage() {
  return (
    <HrPage
      title="ค่าจ้างและกฎหมาย"
      permission={HR_PERMS.payrollManage}
      load={async () => {
        const sets = await wfFetch<Paged<StatutoryRuleSet>>("/statutory-rule-sets");
        const drafts = sets.items.filter((s) => s.status === "DRAFT");

        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <SettingsSubnav active="/hr/settings/statutory" />
          <div className="min-w-0 flex-1">
            <Card className="mb-4 border-(--tone-info)/35 bg-(--tone-info)/10 p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-(--tone-info)" />
                <div>
                  <h2 className="text-sm font-bold text-(--ink)">
                    ชุดกฎยังเป็นฉบับร่าง
                  </h2>
                  <p className="mt-1 text-sm text-(--ink-soft)">
                    ตัวเลขในระบบเป็นค่าทดสอบ ยังคิดเงินคนจริงไม่ได้จนกว่าจะมีผู้เชี่ยวชาญ
                    บัญชี/กฎหมายรับรองและเผยแพร่
                  </p>
                </div>
              </div>
            </Card>

            {drafts.length > 0 && (
              <p className="mb-3 text-sm text-(--ink-soft)">
                มีฉบับร่าง {drafts.length} ชุดที่ยังไม่ถูกเผยแพร่
              </p>
            )}

            {sets.items.length === 0 ? (
              <EmptyState>
                ยังไม่มีชุดกฎ — ติดต่อผู้ดูแลระบบเพื่อสร้างชุดกฎประกันสังคม/ภาษีชุดแรก
              </EmptyState>
            ) : (
              <DataTable
                head={["ประเภท", "ชื่อชุดกฎ", "มีผลตั้งแต่", "ถึง", "สถานะ"]}
              >
                {sets.items.map((set) => (
                  <tr key={set.id} className="hover:bg-(--bg-soft)">
                    <Td className="font-medium">{ruleTypeLabel(set.rule_type)}</Td>
                    <Td>{set.name}</Td>
                    <Td>{formatDate(set.effective_from)}</Td>
                    <Td>
                      {set.effective_to ? formatDate(set.effective_to) : "ไม่กำหนด"}
                    </Td>
                    <Td>
                      <StatusBadge value={set.status} />
                    </Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </div>
          </div>
        );
      }}
    />
  );
}
