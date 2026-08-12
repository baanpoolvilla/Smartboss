import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Users } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold, Fab } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { listPositions } from "@/modules/admin/data/positions";
import { Pill } from "@/modules/admin/components/ui";

export default async function AdminPositionsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.positionView)) redirect("/admin");
  const canManage = hasPermission(session, ADMIN_PERMS.positionManage);

  const positions = await listPositions(session.orgId);

  return (
    <AppScaffold
      title="ตำแหน่ง"
      width="max-w-3xl"
      fab={canManage ? <Fab href="/admin/positions/new" label="สร้างตำแหน่ง" /> : null}
    >
      <p className="mb-4 text-sm text-(--ink-soft)">
        ตำแหน่งเป็นของกลาง ใช้ร่วมกันได้ทุกโมดูล — กำหนดสิทธิ์ระดับตำแหน่งได้เหมือนบทบาท
        คนที่ถือตำแหน่งจะได้สิทธิ์นี้เพิ่มจากบทบาทของตัวเอง
      </p>

      {positions.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีตำแหน่ง
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {positions.map((p) => (
            <Link key={p.id} href={`/admin/positions/${p.id}`}>
              <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-(--bg-soft)">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-(--ink)">{p.name}</p>
                  {p.description && (
                    <p className="truncate text-xs text-(--ink-soft)">{p.description}</p>
                  )}
                </div>
                <Pill color="#3B82F6">
                  <Users className="h-3 w-3" /> {p.userCount}
                </Pill>
                <Pill color="#0D9488">{p.permissionCount} สิทธิ์</Pill>
                <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
