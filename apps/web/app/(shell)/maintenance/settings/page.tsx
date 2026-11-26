import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, FileText, MessageSquare } from "lucide-react";
import { requireOrg, hasPermission, SUPER_ADMIN_ROLE } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { getLineConfig, usersWithPermission } from "@/modules/maintenance/data/notify";
import { userNameMap } from "@/modules/maintenance/data/users";
import { loadExpenseTracking, pendingExpenseWorkOrders } from "@/modules/maintenance/data/expense-tracking";
import {
  AppScaffold,
  AppBarLink,
} from "@/modules/maintenance/components/app-scaffold";
import { saveLineConfigAction, saveWoReviewAction } from "./actions";
import { ExpenseTrackingForm } from "@/modules/maintenance/components/expense-tracking-form";
import { prisma } from "@smartboss/database";
import { todayIso } from "@/modules/hr/lib/date";
import { loadWoReviewEnabled } from "@/modules/maintenance/data/work-order-review";
import { ClipboardCheck } from "lucide-react";

export default async function MaintenanceSettingsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.admin)) redirect("/");

  const lineCfg = await getLineConfig(session.orgId);
  const canSeeUsers = hasPermission(session, ADMIN_PERMS.userView);
  const tracking = await loadExpenseTracking(session.orgId);
  const expenseHolders = await usersWithPermission(session.orgId, MAINT_PERMS.expenseManage);
  // ชื่อของทั้งคนที่มีสิทธิ์และคนที่เคยติ๊กไว้ (ปิดบัญชี/ถอนสิทธิ์แล้วก็ยังขึ้นชื่อให้เอาออกได้)
  const holderNames = await userNameMap(session.orgId, [...expenseHolders, ...tracking.recorderIds]);
  // รายชื่อให้เลือก: แยกแผนก · ไม่รวมผู้ดูแลระบบสูงสุด (ไม่ใช่คนทำงานจริง)
  const holderRows = await prisma.user.findMany({
    where: { orgId: session.orgId, id: { in: expenseHolders } },
    select: { id: true, name: true, department: { select: { name: true } }, roles: { select: { role: { select: { code: true } } } } },
    orderBy: { name: "asc" },
  });
  const recorderOptions = holderRows
    .filter((u) => !u.roles.some((r) => r.role.code === SUPER_ADMIN_ROLE))
    .map((u) => ({ id: u.id, name: u.name, dept: u.department?.name ?? "ไม่ระบุแผนก" }));
  const todayBkk = todayIso();
  const pendingCount = (await pendingExpenseWorkOrders(session.orgId)).length;
  const reviewOn = await loadWoReviewEnabled(session.orgId);

  return (
    <AppScaffold
      title="ตั้งค่าแจ้งซ่อมบำรุง"
      width="max-w-none"
      actions={
        <AppBarLink href="/maintenance/settings/line-log" label="Log การส่ง LINE">
          <FileText className="h-5 w-5" />
        </AppBarLink>
      }
    >
      {/* ─── ตรวจใบงานก่อนบันทึกค่าใช้จ่าย (10/11/2569 · ค่าตั้งต้นเปิด) ─── */}
      <Card className="mb-4 p-5" data-testid="wo-review-settings">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-(--ink)">
          <ClipboardCheck className="h-4 w-4 text-(--brand-green)" /> ตรวจใบงานก่อนบันทึกค่าใช้จ่าย
        </h2>
        <p className="mb-3 text-xs text-(--ink-soft)">
          ใบแจ้งซ่อมที่คนเปิด เมื่อช่างกดยืนยันงานเสร็จ จะไปรอให้คนเปิดใบกด ผ่าน / ไม่ผ่าน ก่อน (แบบงานบนบอร์ด) ผ่านแล้วถึงไปขั้นบันทึกค่าใช้จ่าย
          · ใบ PM อัตโนมัติและใบส่วนตัวไม่ต้องตรวจ · ปิดแล้วใบที่รอตรวจอยู่ยังรอตรวจต่อจนกว่าจะกด
        </p>
        <form action={saveWoReviewAction} className="flex flex-col gap-3">
          <label className="flex w-fit items-center gap-2 text-sm text-(--ink)">
            <input type="checkbox" name="enabled" value="1" defaultChecked={reviewOn} className="h-4 w-4" data-testid="wo-review-enabled" />
            เปิดใช้การตรวจใบงาน
          </label>
          <Button type="submit" className="w-fit">บันทึก</Button>
        </form>
      </Card>

      {/* ─── เตือนลงบิลค่าใช้จ่าย (กติกาเดิม หน้าตั้งค่าใหม่ 18/11/2569) ─── */}
      <Card className="mb-4 p-5">
        <ExpenseTrackingForm
          initialFrom={tracking.from ? tracking.from.toISOString().slice(0, 10) : null}
          initialDays={tracking.days}
          initialRecorderIds={tracking.recorderIds}
          initialRecorderOnly={tracking.recorderOnly ?? false}
          options={recorderOptions}
          allowedIds={expenseHolders}
          names={holderNames}
          pendingCount={pendingCount}
          today={todayBkk}
        />
      </Card>

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
