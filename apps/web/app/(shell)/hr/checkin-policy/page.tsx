import Link from "next/link";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type CheckinPolicyGroup,
  type CheckinPolicyMembership,
  type Company,
  type Employment,
  type Paged,
  type Site,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  NotProvisioned,
  Pill,
  SectionCard,
  Td,
} from "@/modules/hr/components/ui";
import { AssignPanel, CreatePolicyForm } from "./policy-forms";

const METHOD_LABEL: Record<string, string> = {
  MOBILE_PHOTO: "มือถือ",
  FINGERPRINT_DEVICE: "เครื่องสแกน",
  WEB: "เว็บ",
  MANUAL: "HR บันทึก",
};

const PHOTO_LABEL: Record<string, string> = {
  DISABLED: "ไม่ต้องถ่ายรูป",
  ALWAYS: "ถ่ายทุกครั้ง",
  RANDOM: "สุ่มถ่าย",
  RISK_BASED: "ถ่ายเมื่อเสี่ยง",
};

const RISK_LABEL: Record<string, string> = {
  WARN: "แค่เตือน",
  REVIEW: "ส่ง HR ตรวจ",
  REJECT: "ปฏิเสธ",
};

export default async function CheckinPolicyPage() {
  return (
    <HrPage
      title="นโยบายลงเวลาด้วยมือถือ"
      permission={HR_PERMS.settingManage}
      width="max-w-5xl"
      load={async () => {
        const [groups, memberships, companies, sites, employments] = await Promise.all([
          wfFetch<{ items: CheckinPolicyGroup[] }>("/attendance-policy-groups"),
          wfFetch<{ items: CheckinPolicyMembership[] }>("/attendance-policy-group-members"),
          wfTry<Paged<Company>>("/companies"),
          wfTry<Paged<Site>>("/sites"),
          wfTry<Paged<Employment>>("/employments"),
        ]);
        const companyId = companies?.items[0]?.id;

        if (companies !== null && companyId === undefined) {
          return <NotProvisioned what="ตั้งนโยบายลงเวลา" />;
        }

        const groupById = new Map(groups.items.map((g) => [g.id, g]));
        const groupOf = new Map(
          memberships.items.map((m) => [m.employment_id, m.policy_group_id]),
        );

        const active = (employments?.items ?? []).filter((e) => e.terminated_on === null);
        const employees = active.map((employment) => ({
          id: employment.id,
          label: `${employment.employee_code} · ${employment.full_name}`,
          groupId: groupOf.get(employment.id) ?? null,
        }));
        const unassignedCount = employees.filter((e) => e.groupId === null).length;

        const siteList = sites?.items ?? [];
        const noSiteWithPin =
          siteList.filter((s) => s.latitude !== null && s.longitude !== null).length === 0;

        return (
          <div className="space-y-4">
            <SectionCard
              title="ทำไมหน้านี้สำคัญ"
              description="นโยบายคือสิ่งที่ตัดสินว่าพนักงานกดลงเวลาแล้วผ่านหรือไม่ผ่าน"
            >
              <ul className="ml-4 list-disc space-y-1 text-sm text-(--ink-soft)">
                <li>
                  พนักงานที่ <strong className="text-(--ink)">ยังไม่ถูกจัดเข้ากลุ่มไหนเลย</strong>{" "}
                  จะตกไปใช้ค่ามาตรฐานของระบบ ซึ่งบังคับถ่ายรูปทุกครั้งและบังคับให้เครื่อง
                  ต้องได้รับอนุมัติก่อน ⇒ ส่วนใหญ่จะลงเวลาไม่ผ่านโดยไม่รู้สาเหตุ
                </li>
                <li>
                  นโยบายผูกกับ <strong className="text-(--ink)">ช่วงเวลา</strong> — ย้ายกลุ่มแล้ว
                  ผลลงเวลาที่คำนวณไปแล้วไม่ถูกคิดใหม่ให้อัตโนมัติ
                </li>
                <li>
                  ตั้งค่าพิกัดของแต่ละสถานที่ได้ที่{" "}
                  <Link href="/hr/sites" className="text-(--app-strong) hover:underline">
                    สถานที่ทำงาน
                  </Link>{" "}
                  — รัศมีที่ตั้งไว้ที่ตัวสถานที่จะทับค่าในนโยบายนี้
                </li>
              </ul>
            </SectionCard>

            {noSiteWithPin && (
              <SectionCard title="⚠ ยังไม่มีสถานที่ที่ปักหมุดไว้">
                <p className="text-sm text-(--ink-soft)">
                  ตั้งนโยบายไว้ก็ยังลงเวลาด้วยมือถือไม่ผ่าน เพราะระบบไม่มีพิกัดให้เทียบระยะ —{" "}
                  <Link href="/hr/sites" className="text-(--app-strong) hover:underline">
                    ไปเพิ่มสถานที่ก่อน
                  </Link>
                </p>
              </SectionCard>
            )}

            <SectionCard
              title={`กลุ่มนโยบาย (${groups.items.length})`}
              description={
                groups.items.length > 0 && groups.items.every((g) => g.member_count === 0)
                  ? "ทุกกลุ่มยังไม่มีสมาชิก — แปลว่ายังไม่มีใครได้ใช้นโยบายที่ตั้งไว้เลย"
                  : undefined
              }
            >
              {groups.items.length === 0 ? (
                <EmptyState>
                  ยังไม่มีนโยบาย — สร้างกลุ่มแรกข้างล่าง แล้วจัดพนักงานเข้ากลุ่ม
                </EmptyState>
              ) : (
                <DataTable
                  head={["กลุ่ม", "วิธีลงเวลา", "รูป", "พิกัด", "เมื่อเสี่ยง", "สมาชิก"]}
                >
                  {groups.items.map((group) => (
                    <tr key={group.id}>
                      <Td>
                        <span className="font-medium">{group.name}</span>
                        <span className="ml-2 font-mono text-[11px] text-(--ink-soft)">
                          {group.code}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {group.allowed_methods.map((method) => (
                            <Pill key={method}>{METHOD_LABEL[method] ?? method}</Pill>
                          ))}
                        </span>
                      </Td>
                      <Td>{PHOTO_LABEL[group.photo_required] ?? group.photo_required}</Td>
                      <Td>
                        {group.location_required
                          ? `บังคับ · รัศมี ${group.radius_m} ม.`
                          : "ไม่บังคับ"}
                      </Td>
                      <Td>{RISK_LABEL[group.risk_action] ?? group.risk_action}</Td>
                      <Td align="right">
                        {group.member_count === 0 ? (
                          <span className="text-(--tone-warn)">0</span>
                        ) : (
                          group.member_count
                        )}
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </SectionCard>

            <SectionCard
              title="จัดพนักงานเข้ากลุ่ม"
              description={`พนักงานที่ทำงานอยู่ ${employees.length} คน · ยังไม่มีกลุ่ม ${unassignedCount} คน`}
            >
              <AssignPanel
                groups={groups.items}
                employees={employees}
                unassignedCount={unassignedCount}
              />
            </SectionCard>

            {companyId && (
              <SectionCard
                title="สร้างนโยบายใหม่"
                description="ค่าที่เปิดมาให้เป็นชุดที่ใช้งานได้จริงตั้งแต่วันแรก ปรับได้ทุกช่อง"
              >
                <CreatePolicyForm companyId={companyId} sites={siteList} />
              </SectionCard>
            )}

            {groups.items.length > 0 && (
              <p className="text-xs text-(--ink-soft)">
                แก้ไขนโยบายที่สร้างแล้วยังทำจากหน้านี้ไม่ได้ — workforce API ยังไม่มี
                endpoint แก้ไขกลุ่ม · วิธีชั่วคราวคือสร้างกลุ่มใหม่แล้วย้ายคนเข้ากลุ่มนั้น
                (ของเดิมยังอยู่เพื่อให้ย้อนดูอดีตได้)
              </p>
            )}
          </div>
        );
      }}
    />
  );
}
