import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
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
import { SiteCreateForm, SiteEditCard } from "./site-forms";
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

/**
 * การลงเวลา — รวม "สถานที่ทำงาน" (เดิม /hr/sites) กับ "นโยบายลงเวลาด้วยมือถือ"
 * (เดิม /hr/checkin-policy) เป็นหน้าเดียว เพราะรัศมีที่ตั้งไว้ที่ตัวสถานที่จะทับ
 * ค่าในนโยบายเสมอ — สองหน้าแยกทำให้มองไม่เห็นความสัมพันธ์นี้
 */
export default async function AttendanceSettingsPage() {
  return (
    <HrPage
      title="การลงเวลา"
      permission={HR_PERMS.settingManage}
      width="max-w-5xl"
      load={async () => {
        const [sites, companies, groups, memberships, employments] = await Promise.all([
          wfFetch<Paged<Site>>("/sites"),
          // คนที่ตั้งค่าได้อาจไม่มีสิทธิ์อ่านทะเบียนนิติบุคคล — ปล่อยให้ 403
          // ล้มทั้งหน้าจะทำให้เข้าหน้านี้ไม่ได้เลย
          wfTry<Paged<Company>>("/companies"),
          wfFetch<{ items: CheckinPolicyGroup[] }>("/attendance-policy-groups"),
          wfFetch<{ items: CheckinPolicyMembership[] }>("/attendance-policy-group-members"),
          wfTry<Paged<Employment>>("/employments"),
        ]);
        const companyId = companies?.items[0]?.id;

        // companies = null คือไม่มีสิทธิ์อ่าน ไม่ใช่ยังไม่ถูกตั้งต้น — คนละเรื่องกัน
        if (companies !== null && companyId === undefined) {
          return <NotProvisioned what="ตั้งค่าการลงเวลา" />;
        }

        const withoutPin = sites.items.filter(
          (site) => site.latitude === null || site.longitude === null,
        ).length;

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

        /*
         * นับสมาชิกกลุ่มจาก employees ชุดเดียวกับที่ใช้คำนวณ unassignedCount
         * แทนการเชื่อ group.member_count ของ API ตรง ๆ — เดิมสองตัวเลขนี้มาจาก
         * คนละแหล่ง (คนละ query ฝั่ง workforce) แล้วไม่ตรงกันได้ (สเปคข้อ 4.9)
         */
        const memberCountByGroup = new Map<string, number>();
        for (const e of employees) {
          if (e.groupId === null) continue;
          memberCountByGroup.set(e.groupId, (memberCountByGroup.get(e.groupId) ?? 0) + 1);
        }

        const siteList = sites.items;
        const noSiteWithPin =
          siteList.filter((s) => s.latitude !== null && s.longitude !== null).length === 0;

        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <SettingsSubnav active="/hr/settings/attendance" />
            <div className="flex min-w-0 flex-1 flex-col gap-6">
            <div>
              <h2 className="mb-3 text-sm font-bold text-(--ink)">สถานที่ทำงาน</h2>
              <div className="flex flex-col gap-4">
                <SectionCard
                  title="ทำไมหน้านี้สำคัญ"
                  description="พิกัดกับรัศมีที่ตั้งไว้ที่นี่คือตัวตัดสินว่าการลงเวลาด้วยมือถือของพนักงานผ่านหรือไม่ผ่าน"
                >
                  <ul className="ml-4 list-disc space-y-1 text-sm text-(--ink-soft)">
                    <li>
                      พนักงานลงเวลาแล้วระบบจะหาไซต์ที่ใกล้ที่สุด แล้วเทียบระยะกับรัศมีของไซต์นั้น
                    </li>
                    <li>
                      ไซต์ที่ <strong className="text-(--ink)">ไม่มีหมุด</strong>{" "}
                      ใช้ลงเวลาแบบ check-in ไม่ได้ — ระบบไม่มีอะไรให้เทียบระยะ
                    </li>
                    <li>
                      เว้นรัศมีว่างไว้ = ใช้ค่าจากนโยบายของกลุ่มพนักงานด้านล่าง
                      (ตั้งรัศมีที่ไซต์จะทับค่าของนโยบาย)
                    </li>
                    <li>
                      ตั้งรัศมีให้กว้างกว่าความแม่นของ GPS ที่หน้างานจริง — ในอาคารหรือ
                      ตึกสูงบังสัญญาณ ความแม่นมักแย่กว่ากลางที่โล่งหลายเท่า
                    </li>
                  </ul>
                </SectionCard>

                {companyId && (
                  <SectionCard
                    title="เพิ่มสถานที่"
                    description="ยืนอยู่ที่สถานที่นั้นแล้วกด “ใช้ตำแหน่งปัจจุบัน” ได้เลย ไม่ต้องไปหาพิกัดจากแผนที่"
                  >
                    <SiteCreateForm companyId={companyId} />
                  </SectionCard>
                )}

                <SectionCard
                  title={`สถานที่ทั้งหมด (${siteList.length})`}
                  description={
                    withoutPin > 0
                      ? `มี ${withoutPin} แห่งที่ยังไม่มีหมุด — ลงเวลาด้วยมือถือที่นั่นยังไม่ได้`
                      : undefined
                  }
                >
                  {siteList.length === 0 ? (
                    <EmptyState>
                      ยังไม่มีสถานที่ทำงาน — เพิ่มที่แรกก่อน แล้วพนักงานจะเริ่มลงเวลาด้วยมือถือได้
                    </EmptyState>
                  ) : (
                    <div className="space-y-3">
                      {siteList.map((site) => (
                        <SiteEditCard key={site.id} site={site} />
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-bold text-(--ink)">นโยบายลงเวลาด้วยมือถือ</h2>
              <div className="flex flex-col gap-4">
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
                      รัศมีที่ตั้งไว้ที่สถานที่ (ด้านบน) จะทับค่ารัศมีในนโยบายนี้เสมอ
                    </li>
                  </ul>
                </SectionCard>

                {noSiteWithPin && (
                  <SectionCard title="⚠ ยังไม่มีสถานที่ที่ปักหมุดไว้">
                    <p className="text-sm text-(--ink-soft)">
                      ตั้งนโยบายไว้ก็ยังลงเวลาด้วยมือถือไม่ผ่าน เพราะระบบไม่มีพิกัดให้เทียบระยะ —
                      เพิ่มสถานที่ที่ส่วน “สถานที่ทำงาน” ด้านบนก่อน
                    </p>
                  </SectionCard>
                )}

                <SectionCard
                  title={`กลุ่มนโยบาย (${groups.items.length})`}
                  description={
                    groups.items.length > 0 &&
                    groups.items.every((g) => (memberCountByGroup.get(g.id) ?? 0) === 0)
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
                            {(() => {
                              const count = memberCountByGroup.get(group.id) ?? 0;
                              return count === 0 ? (
                                <span className="text-(--tone-warn)">0</span>
                              ) : (
                                count
                              );
                            })()}
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
            </div>
            </div>
          </div>
        );
      }}
    />
  );
}
