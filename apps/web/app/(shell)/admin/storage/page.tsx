import { redirect } from "next/navigation";
import { HardDrive } from "lucide-react";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { EmptyState, Pill } from "@/modules/admin/components/ui";
import { listAllOrganizations } from "@/modules/admin/data/orgs";
import { getOrgCompanyFilesUsage, orgQuotaBytes, toGB } from "@/modules/company-files/lib/quota";
import { setOrgStorageQuotaAction } from "./actions";

/**
 * พื้นที่จัดเก็บไฟล์ (ทุกบริษัท) — หน้าจอระดับผู้ให้บริการ (SUPER_ADMIN เท่านั้น)
 *
 * ตั้งเพดานพื้นที่ไฟล์คลังกลางได้รายบริษัท (แพ็กเกจเสริม) — เว้นว่าง = ใช้ค่ากลางจาก
 * env COMPANY_FILES_ORG_QUOTA_GB การบล็อกตอนอัปโหลดใช้เพดานเดียวกันนี้
 */
export const dynamic = "force-dynamic";

export default async function StorageAdminPage() {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");

  const orgs = await listAllOrganizations();
  const globalLimit = orgQuotaBytes();
  const usages = await Promise.all(orgs.map((o) => getOrgCompanyFilesUsage(o.id)));

  const rows = orgs
    .map((o, i) => {
      const used = usages[i] ?? 0;
      const custom = o.storageQuotaMb != null && o.storageQuotaMb > 0;
      const limit = custom ? o.storageQuotaMb! * 1024 * 1024 : globalLimit;
      const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
      const over = used >= limit;
      const near = !over && used >= limit * 0.75;
      const customGb = custom ? (o.storageQuotaMb! / 1024).toString() : "";
      return { ...o, used, limit, custom, customGb, pct, over, near };
    })
    .sort((a, b) => b.used - a.used);

  const totalUsed = usages.reduce((s, b) => s + b, 0);

  return (
    <AppScaffold title="พื้นที่จัดเก็บไฟล์ (ทุกบริษัท)" width="max-w-4xl" backHref="/admin">
      <p className="mb-4 text-sm text-(--ink-soft)">
        ตั้งเพดานพื้นที่ไฟล์คลังกลาง (โมดูลไฟล์บริษัท) ได้รายบริษัท — เว้นว่างเพื่อใช้ค่ากลาง{" "}
        <span className="font-medium text-(--ink)">{toGB(globalLimit)} GB</span>{" "}
        (env <span className="font-mono text-(--ink)">COMPANY_FILES_ORG_QUOTA_GB</span>)
        เมื่อบริษัทใช้เต็มเพดาน การอัปโหลดไฟล์ใหม่จะถูกบล็อกทันที
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-(--ink-soft)">บริษัททั้งหมด</p>
          <p className="mt-1 text-xl font-bold text-(--ink)">{orgs.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-(--ink-soft)">พื้นที่ใช้รวมทุกบริษัท</p>
          <p className="mt-1 text-xl font-bold text-(--ink)">{toGB(totalUsed)} GB</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-(--ink-soft)">บริษัทที่ใกล้/เกินเพดาน</p>
          <p className="mt-1 text-xl font-bold text-(--ink)">
            {rows.filter((r) => r.near || r.over).length}
          </p>
        </Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState>ยังไม่มีบริษัทในระบบ</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const barColor = r.over
              ? "var(--tone-danger)"
              : r.near
                ? "var(--tone-warn)"
                : "var(--tone-ok)";
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius)"
                    style={{ backgroundColor: "var(--bg-soft)" }}
                  >
                    <HardDrive className="h-5 w-5 text-(--app-strong)" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-(--ink)">
                      {r.name}
                      {r.id === session.orgId && (
                        <span className="text-[11px] font-normal text-(--ink-soft)">
                          (บริษัทที่คุณล็อกอินอยู่)
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-(--ink-soft)">
                      <span className="font-mono text-(--ink)">{r.code}</span> · แพ็กเกจ{" "}
                      {r.planCode ?? "—"}
                    </p>

                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-(--bg-soft)">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${r.pct}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-(--ink-soft)">
                      ใช้ไป <span className="font-medium text-(--ink)">{toGB(r.used)} GB</span> จาก{" "}
                      {toGB(r.limit)} GB ({r.pct}%){" "}
                      {r.custom ? "· เพดานเฉพาะบริษัท" : "· ใช้ค่ากลาง"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Pill color={barColor}>
                      {r.over ? "เต็มแล้ว" : r.near ? "ใกล้เต็ม" : "ปกติ"}
                    </Pill>

                    {/* ตั้งเพดานเฉพาะบริษัท (GB) — เว้นว่าง = ใช้ค่ากลาง */}
                    <form action={setOrgStorageQuotaAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="orgId" value={r.id} />
                      <input
                        type="number"
                        name="quotaGb"
                        min="0"
                        step="0.5"
                        defaultValue={r.customGb}
                        placeholder={`${toGB(globalLimit)} (ค่ากลาง)`}
                        className="h-9 w-28 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)"
                        aria-label={`เพดาน GB ของ ${r.name}`}
                      />
                      <span className="text-xs text-(--ink-soft)">GB</span>
                      <Button type="submit" variant="outline" className="h-9 px-3 text-sm">
                        บันทึก
                      </Button>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-(--ink-soft)">
        ตัวเลขนับเฉพาะไฟล์ในคลังไฟล์กลาง (company-files) ซึ่งเป็นตัวกินพื้นที่หลัก
        — ยังไม่รวมรูปแนบในแชท/รายงาน/งานซ่อม กรอกช่อง GB แล้วกดบันทึกเพื่อตั้งเพดานเฉพาะบริษัท
        เว้นว่างแล้วบันทึก = กลับไปใช้ค่ากลาง
      </p>
    </AppScaffold>
  );
}
