import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, FileText, MessageSquare, ReceiptText } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
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
import { saveExpenseTrackingAction, saveLineConfigAction, saveWoReviewAction } from "./actions";
import { loadWoReviewEnabled } from "@/modules/maintenance/data/work-order-review";
import { ClipboardCheck } from "lucide-react";

import { ceoTitle } from "@/lib/ceo-title";
export default async function MaintenanceSettingsPage() {
  const ceo = await ceoTitle();
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.admin)) redirect("/");

  const lineCfg = await getLineConfig(session.orgId);
  const canSeeUsers = hasPermission(session, ADMIN_PERMS.userView);
  const tracking = await loadExpenseTracking(session.orgId);
  const expenseHolders = await usersWithPermission(session.orgId, MAINT_PERMS.expenseManage);
  const holderNames = await userNameMap(session.orgId, expenseHolders);
  const pendingCount = (await pendingExpenseWorkOrders(session.orgId)).length;
  // ติ๊กไว้แต่ทำงานไม่ได้แล้ว (ปิดบัญชี/ถอนสิทธิ์) — ไม่มีใครรับงาน ไม่มีใครโดนหัก ต้องบอกให้รู้
  const lostRecorders = tracking.recorderIds.filter((id) => !expenseHolders.includes(id)).length;
  const noRecorder = !!tracking.from && tracking.recorderIds.length === lostRecorders;
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

      {/* ─── กำหนดบันทึกค่าใช้จ่าย ─── */}
      <Card className="mb-4 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-(--ink)">
          <ReceiptText className="h-4 w-4 text-(--brand-green)" /> กำหนดบันทึกค่าใช้จ่าย
        </h2>
        <p className="mb-3 text-xs text-(--ink-soft)">
          ใบงานที่ปิดแล้วและยังไม่บันทึกค่าใช้จ่าย จะขึ้นเป็นงานของผู้บันทึกพร้อมวันครบกำหนด เลยกำหนดหักคะแนนผู้บันทึกทุกคน
          ผู้บันทึกเห็นเฉพาะใบที่เกี่ยวกับตัวเองและใบที่รอบันทึก · ตอนนี้รอบันทึก {pendingCount} ใบ
          · ใบที่ปิดก่อนวันเริ่มใช้นับเวลาจากวันเริ่มใช้และไม่หักคะแนน
        </p>
        <form action={saveExpenseTrackingAction} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              วันเริ่มใช้ (เว้นว่าง = ปิด)
              <Input type="date" name="from" defaultValue={tracking.from ? tracking.from.toISOString().slice(0, 10) : ""} className="w-48" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              ปิดงานแล้วมีเวลาบันทึก (วัน)
              <Input type="number" name="days" min={1} max={90} defaultValue={tracking.days} className="w-32" />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm">ผู้บันทึกค่าใช้จ่าย</span>
            {lostRecorders > 0 && (
              <span role="alert" className="rounded-(--radius) bg-amber-50 px-2 py-1 text-xs text-amber-800">
                มีผู้บันทึก {lostRecorders} คนที่ปิดบัญชีหรือถูกถอนสิทธิ์แล้ว{noRecorder ? " ตอนนี้ไม่มีใครรับงานนี้เลย" : ""} เลือกคนใหม่แล้วกดบันทึก
              </span>
            )}
            {expenseHolders.length === 0 ? (
              <span className="text-xs text-(--ink-soft)">ยังไม่มีใครมีสิทธิ์บันทึก/แก้ไขค่าใช้จ่าย ให้สิทธิ์ที่หน้าบทบาทก่อน</span>
            ) : (
              expenseHolders.map((id) => (
                <label key={id} className="flex w-fit items-center gap-2 text-sm text-(--ink)">
                  <input type="checkbox" name="recorderIds" value={id} defaultChecked={tracking.recorderIds.includes(id)} className="h-4 w-4" />
                  {holderNames[id] ?? id}
                </label>
              ))
            )}
            <span className="text-xs text-(--ink-soft)">รายชื่อคือคนที่มีสิทธิ์บันทึก/แก้ไขค่าใช้จ่าย · {ceo} ที่ติ๊กไว้ยังเห็นทุกใบตามเดิม</span>
          </div>
          <Button type="submit" className="w-fit">บันทึก</Button>
        </form>
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
