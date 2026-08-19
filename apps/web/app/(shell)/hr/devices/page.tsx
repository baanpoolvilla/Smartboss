import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type Device,
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
  issueDeviceTokenAction,
  revokeDeviceAction,
} from "../actions";

export default async function DevicesPage() {
  const session = await requireOrg();
  const canManage = hasPermission(session, HR_PERMS.settingManage);

  return (
    <HrPage
      title="เครื่องสแกน"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const [devices, companies] = await Promise.all([
          wfFetch<Paged<Device>>("/devices"),
          wfTry<Paged<Company>>("/companies"),
        ]);
        const companyId = companies?.items[0]?.id;

        // companies = null คือไม่มีสิทธิ์อ่าน ไม่ใช่ยังไม่ถูกตั้งต้น — คนละเรื่องกัน
        if (companies !== null && companyId === undefined) {
          return <NotProvisioned what="ลงทะเบียนเครื่องสแกน" />;
        }

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
                        <form action={issueDeviceTokenAction}>
                          <input type="hidden" name="deviceId" value={device.id} />
                          <Button type="submit" size="sm" variant="outline">
                            ออกโทเคนผูกเครื่อง
                          </Button>
                        </form>
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
          </>
        );
      }}
    />
  );
}
