import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { EmptyState, Pill } from "@/modules/admin/components/ui";
import { listAllOrganizations } from "@/modules/admin/data/orgs";
import { listWorkforceTenantIds } from "@/modules/admin/data/workforce-tenants";
import { repairWorkforceTenantAction } from "../actions";

/**
 * บริษัททั้งหมดในแพลตฟอร์ม — หน้าจอระดับผู้ให้บริการ ไม่ใช่ของบริษัทใด
 *
 * ต่างจาก /admin/organization (เอกพจน์) ที่แก้ข้อมูลบริษัทตัวเองเท่านั้น
 * หน้านี้เห็นทุกบริษัทและเปิดบริษัทใหม่ได้ — SUPER_ADMIN เท่านั้น
 */
export const dynamic = "force-dynamic";

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; warn?: string }>;
}) {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");

  const [orgs, { created, warn }] = await Promise.all([
    listAllOrganizations(),
    searchParams,
  ]);
  // ต้องรู้รายชื่อบริษัทก่อน เพราะการอ่านตาราง workforce ต้องตั้ง tenant context
  // ทีละบริษัท (FORCE RLS — ดูคอมเมนต์ใน workforce-tenants.ts)
  const workforceTenants = await listWorkforceTenantIds(orgs.map((o) => o.id));

  return (
    <AppScaffold
      title="บริษัททั้งหมด"
      width="max-w-4xl"
      backHref="/admin"
      actions={
        <Link href="/admin/organizations/new">
          <Button className="h-9 gap-1.5 px-3 text-sm">
            <Plus className="h-4 w-4" />
            เปิดบริษัทใหม่
          </Button>
        </Link>
      }
    >
      {created && (
        <Card className="mb-4 border-(--tone-ok) p-4 text-sm">
          <p className="font-semibold text-(--tone-ok)">
            เปิดบริษัท “{created}” เรียบร้อย
          </p>
          <p className="mt-1 text-(--ink-soft)">
            ผู้ดูแลของบริษัทนี้ login ได้ทันทีด้วยอีเมลและรหัสผ่านที่ตั้งไว้
            แล้วเพิ่มพนักงานเองที่หน้าผู้ใช้งานของบริษัทตัวเอง
          </p>
        </Card>
      )}

      {warn && (
        <Card className="mb-4 border-(--tone-warn) p-4 text-sm">
          <p className="font-semibold text-(--tone-warn)">
            บริษัทถูกสร้างแล้ว แต่เปิดโมดูลบุคคลไม่สำเร็จ
          </p>
          <p className="mt-1 text-(--ink-soft)">
            โมดูลอื่นใช้ได้ตามปกติ ส่วนโมดูลบุคคลจะไม่มีข้อมูลจนกว่าจะกด
            “เปิดโมดูลบุคคล” ที่รายการด้านล่าง
          </p>
        </Card>
      )}

      <p className="mb-3 text-sm text-(--ink-soft)">
        {orgs.length} บริษัท · รวมผู้ใช้{" "}
        {orgs.reduce((sum, o) => sum + o.userCount, 0)} คน
      </p>

      {orgs.length === 0 ? (
        <EmptyState>ยังไม่มีบริษัทในระบบ</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {orgs.map((org) => {
            const hasWorkforce = workforceTenants.has(org.id);
            return (
              <Card key={org.id} className="p-4">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius)"
                    style={{ backgroundColor: "var(--bg-soft)" }}
                  >
                    <Building2 className="h-5 w-5 text-(--app-strong)" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-(--ink)">
                      {org.name}
                      {org.id === session.orgId && (
                        <span className="text-[11px] font-normal text-(--ink-soft)">
                          (บริษัทที่คุณล็อกอินอยู่)
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-(--ink-soft)">
                      รหัส {org.slug} · {org.userCount} ผู้ใช้ · แพ็กเกจ{" "}
                      {org.planCode ?? "—"}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Pill color={org.isActive ? "var(--tone-ok)" : "var(--tone-danger)"}>
                        {org.isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}
                      </Pill>
                      <Pill
                        color={hasWorkforce ? "var(--tone-ok)" : "var(--tone-warn)"}
                      >
                        {hasWorkforce ? "โมดูลบุคคลพร้อม" : "โมดูลบุคคลยังไม่พร้อม"}
                      </Pill>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    <Link href={`/admin/users?orgId=${org.id}`}>
                      <Button variant="outline" className="h-9 w-full px-3 text-sm">
                        ดูผู้ใช้
                      </Button>
                    </Link>
                    {!hasWorkforce && (
                      <form action={repairWorkforceTenantAction}>
                        <input type="hidden" name="orgId" value={org.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          className="h-9 w-full px-3 text-sm"
                        >
                          เปิดโมดูลบุคคล
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-(--ink-soft)">
        “โมดูลบุคคลยังไม่พร้อม” หมายถึงบริษัทนั้นยังไม่มี tenant ฝั่ง workforce —
        หน้าจอในโมดูลบุคคลจะว่างเปล่าโดยไม่มีข้อความแจ้ง กดปุ่มเพื่อเปิดให้ (กดซ้ำได้)
      </p>
    </AppScaffold>
  );
}
