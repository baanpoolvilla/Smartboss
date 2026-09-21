import { createElement } from "react";
import type { ModuleManifest } from "@/module-registry";
import { NotifCountBadge } from "@/modules/notifications/notif-count-badge";

import { ISSUE_REPORTS_BASE, REPORT_TASK_CODE } from "./constants";
import { REPORT_TASK_PERMS } from "./permissions";

export const ISSUE_REPORT_SELF_CODE = "issue_report_self";

/**
 * "แจ้งบัค" ฝั่งผู้ใช้ทั่วไป — โมดูลของตัวเองแบบเดียวกับ "แจ้งบัค" ของ
 * Super Admin (admin/issue-report-manifest.ts) กดจากหน้าแรกแล้วจบอยู่ในโมดูลนี้
 * เลย ไม่ปนเมนูรายงานและงาน ("อยากให้ user กดเข้าไปแล้วเจอแบบแอดมิน ให้มัน
 * จบที่โมดูลนี้ ไม่ไปยุ่งกับอันอื่น ... user เห็นแค่ตั๋วของฉันแค่นั้นพอ")
 *
 * หน้าอยู่ที่ /issue-reports (ไม่อยู่ใต้ /report-task แล้ว) แต่ข้อมูลตั๋วยังเก็บ
 * ใน store ของ report_task — layout ของ /issue-reports ใช้ตัวห่อเดียวกับโมดูล
 * รายงานและงาน ลิงก์เก่า /report-task/issue-reports redirect มาที่นี่ (next.config)
 *
 * ไม่มีแถว Module ใน DB ของ code นี้ — เปิดตามโมดูล report_task ของบริษัท
 * (requiresModule) ไม่ใช่ alwaysOn เพื่อไม่โผล่ให้บริษัทที่ไม่ได้ใช้ report_task
 * ส่วนสิทธิ์ใช้ report_task.access เหมือนที่หน้านี้เคยใช้
 */
export const issueReportSelfManifest: ModuleManifest = {
  id: ISSUE_REPORT_SELF_CODE,
  name: "แจ้งบัค",
  color: "#dc2626",
  colorBg: "#fef2f2",
  basePath: ISSUE_REPORTS_BASE,
  icon: "Bug",
  requiresModule: REPORT_TASK_CODE,
  menus: [
    {
      label: "ตั๋วของฉัน",
      path: ISSUE_REPORTS_BASE,
      permission: REPORT_TASK_PERMS.access,
      icon: "User",
      badge: createElement(NotifCountBadge, {
        categories: ["ticket"],
        className:
          "ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white",
      }),
    },
  ],
  permissions: [REPORT_TASK_PERMS.access],
};
