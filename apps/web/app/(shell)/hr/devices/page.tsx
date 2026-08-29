import Link from "next/link";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type BiometricEnrollment,
  type Company,
  type Device,
  type Employment,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Field,
  NotProvisioned,
  Pill,
  SectionCard,
  StatusBadge,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import { deviceTypeLabel, formatDateTime } from "@/modules/hr/lib/labels";
import {
  createDeviceAction,
  deleteEnrollmentsAction,
  revokeDeviceAction,
} from "../actions";
import { IssueTokenButton } from "./issue-token-button";

const FINGER_LABEL: Record<string, string> = {
  RIGHT_THUMB: "นิ้วโป้งขวา",
  RIGHT_INDEX: "นิ้วชี้ขวา",
  RIGHT_MIDDLE: "นิ้วกลางขวา",
  LEFT_THUMB: "นิ้วโป้งซ้าย",
  LEFT_INDEX: "นิ้วชี้ซ้าย",
  LEFT_MIDDLE: "นิ้วกลางซ้าย",
};

const ENROLL_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "รอวางนิ้วที่เครื่อง", tone: "var(--tone-warn)" },
  ACTIVE: { label: "ใช้งานได้", tone: "var(--tone-ok)" },
  DELETED: { label: "ลบแล้ว", tone: "var(--tone-muted)" },
};

export default async function DevicesPage() {
  const session = await requireOrg();
  const canManage = hasPermission(session, HR_PERMS.settingManage);

  return (
    <HrPage
      title="เครื่องสแกน"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const [devices, companies, employments, enrollments] = await Promise.all([
          wfFetch<Paged<Device>>("/devices"),
          wfTry<Paged<Company>>("/companies"),
          // wfTry: คนที่ดูเครื่องได้อาจไม่มีสิทธิ์อ่านทะเบียนพนักงาน
          // ปล่อยให้ 403 ล้มทั้งหน้าจะทำให้เข้าหน้าเครื่องสแกนไม่ได้เลย
          wfTry<Paged<Employment>>("/employments"),
          wfTry<Paged<BiometricEnrollment>>("/biometric-enrollments"),
        ]);
        const companyId = companies?.items[0]?.id;

        // companies = null คือไม่มีสิทธิ์อ่าน ไม่ใช่ยังไม่ถูกตั้งต้น — คนละเรื่องกัน
        if (companies !== null && companyId === undefined) {
          return <NotProvisioned what="ลงทะเบียนเครื่องสแกน" />;
        }

        // สั่ง enroll ได้เฉพาะเครื่องที่ activate แล้ว — ฝั่ง API ปฏิเสธด้วย 409
        // ถ้าเครื่องยังไม่ ACTIVE จึงไม่มีประโยชน์ที่จะให้เลือก
        const enrollableDevices = devices.items.filter((d) => d.status === "ACTIVE");
        const activeEmployments = (employments?.items ?? []).filter(
          (e) => e.terminated_on === null,
        );
        const liveEnrollments = (enrollments?.items ?? []).filter(
          (en) => en.status !== "DELETED",
        );


        const employmentName = new Map(
          activeEmployments.map((e) => [e.id, `${e.employee_code} · ${e.full_name}`]),
        );
        const deviceCode = new Map(devices.items.map((d) => [d.id, d.device_code]));

        return (
          <>
            <p className="mb-3 text-sm text-(--ink-soft)">
              แต่ละเครื่องเซ็นข้อมูลด้วยกุญแจ Ed25519 ของตัวเอง
              private key ไม่เคยออกจากเครื่อง — ไม่มี API key ร่วมกัน
            </p>

            {canManage && companyId && (
              <SectionCard title="ลงทะเบียนเครื่องใหม่" className="mb-4">
                <form
                  action={createDeviceAction}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-4"
                >
                  <input type="hidden" name="company_id" value={companyId} />
                  <Field label="รหัสเครื่อง *" hint="A-Z 0-9 . _ -">
                    <input
                      name="device_code"
                      required
                      maxLength={50}
                      pattern="[A-Za-z0-9._\-]+"
                      placeholder="TERM-01"
                      className={`${inputClass} font-mono`}
                    />
                  </Field>
                  <Field label="ชื่อเครื่อง">
                    <input name="name" maxLength={120} className={inputClass} />
                  </Field>
                  <Field label="ประเภท">
                    <select
                      name="device_type"
                      defaultValue="FINGERPRINT_TERMINAL"
                      className={inputClass}
                    >
                      <option value="FINGERPRINT_TERMINAL">เครื่องสแกนลายนิ้วมือ</option>
                      <option value="KIOSK">Kiosk</option>
                      <option value="GATEWAY">Gateway</option>
                    </select>
                  </Field>
                  <div className="flex items-end">
                    <Button type="submit">ลงทะเบียน</Button>
                  </div>
                </form>
              </SectionCard>
            )}

            {devices.items.length === 0 ? (
              <EmptyState>ยังไม่มีเครื่องสแกนลงทะเบียน</EmptyState>
            ) : (
            <DataTable
              head={[
                "รหัสเครื่อง",
                "ชื่อ",
                "ประเภท",
                "เฟิร์มแวร์",
                "เห็นล่าสุด",
                "สถานะ",
                ...(canManage ? ["จัดการ"] : []),
              ]}
            >
              {devices.items.map((device) => (
                <tr key={device.id} className="hover:bg-(--bg-soft)">
                  <Td className="font-mono text-xs">{device.device_code}</Td>
                  <Td className="font-medium">{device.name}</Td>
                  <Td>{deviceTypeLabel(device.device_type)}</Td>
                  <Td>{device.firmware_version ?? "—"}</Td>
                  <Td>{formatDateTime(device.last_seen_at)}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={device.status} />
                      {device.has_active_credential ? (
                        <Pill tone="var(--tone-ok)">มีกุญแจ</Pill>
                      ) : (
                        <Pill tone="var(--tone-warn)">ยังไม่ผูกกุญแจ</Pill>
                      )}
                    </div>
                  </Td>
                  {canManage && (
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <IssueTokenButton deviceId={device.id} />
                        {device.has_active_credential && (
                          <form action={revokeDeviceAction}>
                            <input type="hidden" name="deviceId" value={device.id} />
                            <Button type="submit" size="sm" variant="danger">
                              เพิกถอน
                            </Button>
                          </form>
                        )}
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </DataTable>
            )}

            {canManage && (
              <SectionCard
                title="ลายนิ้วมือที่ผูกไว้แล้ว"
                description="จนกว่า slot จะถูกผูก การสแกนจะถูกบันทึกแต่ไม่มีเจ้าของ และผลลงเวลาจะขึ้นว่าขาดงาน"
                className="mt-6"
              >
                <p className="text-sm text-(--ink-soft)">
                  ผูกลายนิ้วมือย้ายไปอยู่ในหน้าของพนักงานแต่ละคนแล้ว —{" "}
                  <Link
                    href="/hr/employees"
                    className="text-(--app-strong) hover:underline"
                  >
                    ไปที่ทะเบียนพนักงาน
                  </Link>{" "}
                  → เลือกคน → “ลายนิ้วมือ” · ตารางข้างล่างเป็นภาพรวมว่าใครผูกไว้กับเครื่องไหนบ้าง
                </p>

                {liveEnrollments.length > 0 && (
                  <div className="mt-4">
                    <DataTable
                      head={["พนักงาน", "เครื่อง", "Slot", "นิ้ว", "สถานะ", "ลงทะเบียนเมื่อ", "ลบ"]}
                    >
                      {liveEnrollments.map((en) => {
                        const status = ENROLL_STATUS[en.status] ?? {
                          label: en.status,
                          tone: "var(--tone-muted)",
                        };
                        return (
                          <tr key={en.id} className="hover:bg-(--bg-soft)">
                            <Td className="font-medium">
                              {employmentName.get(en.employment_id) ?? "—"}
                            </Td>
                            <Td className="font-mono text-xs">
                              {deviceCode.get(en.device_id) ?? "—"}
                            </Td>
                            <Td className="font-mono">{en.template_slot}</Td>
                            <Td>
                              {en.finger_position
                                ? (FINGER_LABEL[en.finger_position] ?? en.finger_position)
                                : "—"}
                            </Td>
                            <Td>
                              <Pill tone={status.tone}>{status.label}</Pill>
                            </Td>
                            <Td>{formatDateTime(en.enrolled_at)}</Td>
                            <Td>
                              <form action={deleteEnrollmentsAction}>
                                <input
                                  type="hidden"
                                  name="employmentId"
                                  value={en.employment_id}
                                />
                                <Button type="submit" size="sm" variant="danger">
                                  ลบทุกเครื่อง
                                </Button>
                              </form>
                            </Td>
                          </tr>
                        );
                      })}
                    </DataTable>
                    <p className="mt-2 text-xs text-(--ink-soft)">
                      workforce ลบลายนิ้วมือเป็นรายคนเสมอ ไม่ลบทีละเครื่อง —
                      การเหลือนิ้วค้างอยู่เครื่องใดเครื่องหนึ่งหลังคนลาออก
                      คือช่องให้ลงเวลาแทนกันได้
                    </p>
                  </div>
                )}
              </SectionCard>
            )}
          </>
        );
      }}
    />
  );
}
