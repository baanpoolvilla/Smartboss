import { AlertTriangle } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, type Paged, type StatutoryRuleSet } from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  Td,
} from "@/modules/hr/components/ui";
import { formatDate, ruleTypeLabel } from "@/modules/hr/lib/labels";

export default async function RuleSetsPage() {
  return (
    <HrPage
      title="ชุดกฎตามกฎหมาย"
      permission={HR_PERMS.payrollManage}
      load={async () => {
        const sets = await wfFetch<Paged<StatutoryRuleSet>>("/statutory-rule-sets");
        const drafts = sets.items.filter((s) => s.status === "DRAFT");

        return (
          <>
            {/* คำเตือนสำคัญ — ระบบยังคิดเงินคนจริงไม่ได้จนกว่าจะมีผู้รับรอง */}
            <Card className="mb-4 border-(--danger-line) bg-(--danger-bg) p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-(--danger)" />
                <div>
                  <h2 className="text-sm font-bold text-(--danger)">
                    ชุดกฎยังเป็นฉบับร่าง — ยังคิดเงินคนจริงไม่ได้
                  </h2>
                  <p className="mt-1 text-sm text-(--ink-soft)">
                    ตัวเลขในระบบเป็นค่าทดสอบ ระบบบล็อกไว้สองชั้น (engine + CHECK constraint)
                    ว่าเผยแพร่ไม่ได้ถ้าไม่มีแหล่งอ้างอิงกฎหมาย ผู้รับรอง และ golden test ผ่าน
                    — ต้องให้ผู้เชี่ยวชาญบัญชี/กฎหมายรับรองก่อนใช้งานจริง
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
              <EmptyState>ยังไม่มีชุดกฎ</EmptyState>
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
          </>
        );
      }}
    />
  );
}
