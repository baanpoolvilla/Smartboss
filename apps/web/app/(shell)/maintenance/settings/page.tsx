import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, FileText, MessageSquare } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { getLineConfig } from "@/modules/maintenance/data/notify";
import {
  AppScaffold,
  AppBarLink,
} from "@/modules/maintenance/components/app-scaffold";
import { saveLineConfigAction } from "./actions";

export default async function MaintenanceSettingsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.admin)) redirect("/");

  const lineCfg = await getLineConfig(session.orgId);
  const canSeeUsers = hasPermission(session, ADMIN_PERMS.userView);

  return (
    <AppScaffold
      title="ตั้งค่าแจ้งซ่อมบำรุง"
      width="max-w-3xl"
      actions={
        <AppBarLink href="/maintenance/settings/line-log" label="Log การส่ง LINE">
          <FileText className="h-5 w-5" />
        </AppBarLink>
      }
    >
      {/* ─── LINE config (ของโมดูลนี้โดยเฉพาะ) ─── */}
      <Card className="mb-4 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-(--ink)">
          <MessageSquare className="h-4 w-4" style={{ color: "#06C755" }} /> LINE
          Messaging API
        </h2>
        <p className="mb-3 text-xs text-(--ink-soft)">
          แต่ละบริษัทใช้ LINE Official Account ของตัวเอง — ใส่ Channel Access Token
          จาก LINE Developers
        </p>
        <form action={saveLineConfigAction} className="flex flex-col gap-3">
          <label className="text-sm">
            Channel Access Token
            <Input
              name="token"
              defaultValue={lineCfg?.channelAccessToken ?? ""}
              placeholder="วาง token ที่นี่"
              className="mt-1"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enabled"
              value="1"
              defaultChecked={lineCfg?.enabled ?? false}
            />
            เปิดใช้งานการแจ้งเตือน LINE
          </label>
          <div>
            <Button type="submit" className="sm:w-40">
              บันทึก
            </Button>
          </div>
        </form>
      </Card>

      {/* ─── ผู้ใช้/บทบาท ย้ายไปหลังบ้านกลางแล้ว ─── */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-(--ink)">
          ผู้ใช้งานและบทบาท
        </h2>
        <p className="mb-3 text-xs text-(--ink-soft)">
          ย้ายไปจัดการรวมที่หลังบ้านแล้ว เพื่อให้สิทธิ์ของทุกโมดูลอยู่ที่เดียวกัน
          — รวมถึงการผูก LINE User ID ของแต่ละคน
        </p>
        {canSeeUsers ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/users">
              <Button variant="outline" size="sm" className="gap-1">
                จัดการผู้ใช้งาน <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Link href="/admin/roles">
              <Button variant="outline" size="sm" className="gap-1">
                บทบาท &amp; สิทธิ์ <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        ) : (
          <p className="text-sm text-(--ink-soft)">
            ต้องมีสิทธิ์เข้าหลังบ้าน — ติดต่อผู้ดูแลระบบ
          </p>
        )}
      </Card>
    </AppScaffold>
  );
}
