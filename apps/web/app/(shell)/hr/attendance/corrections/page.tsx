import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  type AttendanceCorrection,
  type Employment,
  type Paged,
} from "@/modules/hr/lib/api";
import { EmptyState, SectionCard } from "@/modules/hr/components/ui";
import { CorrectionCard, ManualAttendanceForm } from "./correction-forms";

export default async function AttendanceCorrectionsPage() {
  return (
    <HrPage
      title="ลงเวลาแบบ manual"
      permission={HR_PERMS.employeeManage}
      width="max-w-4xl"
      load={async () => {
        const [corrections, employments] = await Promise.all([
          // ไม่กรอง status — คิวต้องเห็นทั้งที่รอคนที่ 1/2 พร้อมกัน และเก็บ
          // ประวัติที่อนุมัติ/ปฏิเสธแล้วไว้ตรวจสอบย้อนหลังในหน้าเดียว
          wfFetch<{ items: AttendanceCorrection[] }>("/attendance-correction-requests"),
          wfFetch<Paged<Employment>>("/employments"),
        ]);

        const activeEmployees = employments.items.filter((e) => e.terminated_on === null);
        const pending = corrections.items.filter(
          (c) => c.status === "PENDING",
        );
        const decided = corrections.items.filter((c) => c.status !== "PENDING");

        return (
          <div className="space-y-4">
            <SectionCard
              title="ทำไมต้องอนุมัติสองคน"
              description="การแก้เวลาลงงานกระทบเงินเดือนโดยตรง ผู้จัดการคนเดียวอนุมัติเองไม่พอ"
            >
              <ul className="ml-4 list-disc space-y-1 text-sm text-(--ink-soft)">
                <li>
                  ต้องมีผู้จัดการขึ้นไป <strong className="text-(--ink)">สองคนที่ไม่ซ้ำกัน</strong>{" "}
                  กดอนุมัติ — คนที่ 2 ต้องต่างจากทั้งคนที่ 1 และคนที่ขอ
                </li>
                <li>
                  กดอนุมัติครั้งแรกยัง<strong className="text-(--ink)">ไม่มีผลทันที</strong> —
                  เวลาทำงานจะยังไม่เปลี่ยนจนกว่าจะครบสองคน
                </li>
                <li>ปฏิเสธได้ตลอดจนกว่าจะอนุมัติครบสองคน หลังจากนั้นถือเป็นที่สิ้นสุด</li>
              </ul>
            </SectionCard>

            <SectionCard
              title="ส่งคำขอลงเวลาใหม่"
              description="สำหรับพนักงานที่ลืมสแกน เครื่องเสีย หรือไม่มีทางลงเวลาปกติได้"
            >
              <ManualAttendanceForm employees={activeEmployees} />
            </SectionCard>

            <SectionCard title={`รอดำเนินการ (${pending.length})`}>
              {pending.length === 0 ? (
                <EmptyState>ไม่มีคำขอที่รออนุมัติ</EmptyState>
              ) : (
                <div className="space-y-3">
                  {pending.map((correction) => (
                    <CorrectionCard key={correction.id} correction={correction} />
                  ))}
                </div>
              )}
            </SectionCard>

            {decided.length > 0 && (
              <SectionCard title={`ประวัติ (${decided.length})`}>
                <div className="space-y-3">
                  {decided.map((correction) => (
                    <CorrectionCard key={correction.id} correction={correction} />
                  ))}
                </div>
              </SectionCard>
            )}
          </div>
        );
      }}
    />
  );
}
