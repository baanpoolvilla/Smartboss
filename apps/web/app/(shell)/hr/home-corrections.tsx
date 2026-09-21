import {
  wfFetch,
  type AttendanceCorrection,
  type Employment,
  type Paged,
} from "@/modules/hr/lib/api";
import { EmptyState, SectionCard } from "@/modules/hr/components/ui";
import { HelpPopover } from "@/modules/hr/components/design-kit-client";
import { CorrectionCard } from "./attendance/corrections/correction-forms";
import { NewCorrectionButton } from "./attendance/corrections/new-correction-button";

/** เนื้อหาแท็บ "คำขอแก้เวลา" ของหน้าหลัก — เดิมคือหน้า /hr/attendance/corrections */
export async function renderCorrectionsTab(): Promise<React.ReactNode> {
  const [corrections, employments] = await Promise.all([
    // ไม่กรอง status — คิวต้องเห็นทั้งที่รอคนที่ 1/2 พร้อมกัน และเก็บ
    // ประวัติที่อนุมัติ/ปฏิเสธแล้วไว้ตรวจสอบย้อนหลังในหน้าเดียว
    wfFetch<{ items: AttendanceCorrection[] }>("/attendance-correction-requests"),
    wfFetch<Paged<Employment>>("/employments"),
  ]);

  const activeEmployees = employments.items.filter((e) => e.terminated_on === null);
  const pending = corrections.items.filter((c) => c.status === "PENDING");
  const decided = corrections.items.filter((c) => c.status !== "PENDING");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-(--ink-soft)">
          ตรวจสอบและอนุมัติเวลาที่พนักงานขอแก้ไข
          <HelpPopover label="ใครอนุมัติได้บ้าง">
            การแก้เวลาลงงานกระทบเงินเดือนโดยตรง — <strong>ผู้อนุมัติต้องไม่ใช่คนที่ขอ</strong>{" "}
            เสมอ · จำนวนผู้อนุมัติที่ต้องมีตั้งได้ที่ ตั้งค่า → การลงเวลา (ค่าเริ่มต้น 1 คน
            อนุมัติแล้วมีผลทันที) ถ้าตั้งไว้ 2 คน คนที่ 2 ต้องต่างจากคนแรก และอนุมัติคนแรก
            ยังไม่มีผลจนกว่าจะครบ · ปฏิเสธได้ตลอดจนกว่าจะอนุมัติครบ
          </HelpPopover>
        </h2>
        <NewCorrectionButton employees={activeEmployees} />
      </div>

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
}
