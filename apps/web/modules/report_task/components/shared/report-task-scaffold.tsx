"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { AppScaffold } from "@/components/module/app-scaffold";

import { ISSUE_REPORTS_BASE, REPORT_TASK_BASE } from "../../constants";
import { reportTaskManifest } from "../../manifest";
import { useEmployeeStore } from "../../store/employee-store";
import { useIdentityStore } from "../../store/identity-store";
import type { User } from "../../types";
import { AppBarLeadingProvider, useAppBarLeading } from "./app-bar-leading";
import { StoreHydrator } from "./store-hydrator";
import { TaskSync } from "./task-sync";
import { TourOverlay } from "./tour-overlay";

/**
 * ครอบทุกหน้าของโมดูลด้วย AppScaffold ตัวเดียวกับ maintenance / hr / admin
 *
 * ทำที่ layout ที่เดียวแทนที่จะไปแก้ทั้ง 8 หน้า เพราะทุกหน้าของโมดูลนี้เป็น
 * หน้าระดับบนสุดเหมือนกันหมด (ไม่มีหน้ารายละเอียดที่ต้องมีปุ่มย้อนกลับ)
 * ชื่อหัวข้อดึงจาก manifest ตาม pathname จะได้ไม่ต้องเขียนชื่อซ้ำสองที่
 *
 * ไม่จำกัดความกว้างเนื้อหาเลย (`max-w-none`) — เว็บมีแต่จอกว้าง (มือถือมี
 * bottom nav ของตัวเอง ไม่ผ่าน rail นี้) การจำกัด max-width แล้วดันเนื้อหาไป
 * กองกลางจอปล่อยขอบว่างซ้าย-ขวาเยอะโดยเปล่าประโยชน์บนจอกว้าง โดยเฉพาะ
 * บอร์ด Kanban กับปฏิทินที่กินพื้นที่แนวนอนเยอะอยู่แล้ว.
 */
export function ReportTaskScaffold({
  currentUser,
  children,
}: {
  /** ผู้ใช้ที่ล็อกอิน — ประกอบจาก core.users ที่ layout ฝั่งเซิร์ฟเวอร์ */
  currentUser: User;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  /*
   * โมดูลต้นทางออกแบบตอนยังไม่มี auth จึงมีตัวสลับ "ดูในนามของ" ฝั่ง client
   * ที่นี่ต้องล็อกให้เป็นคนที่ล็อกอินจริง ไม่งั้นงานที่สร้างและคะแนนที่หัก
   * จะไปเข้าคนอื่น และหน้าสรุปของผู้บริหารจะอ่านไม่ได้เรื่อง
   */
  /*
   * ⚠ ต้องใส่ตัวเองเข้าไปใน "สมุดรายชื่อ" ก่อนสลับตัวตน ห้ามสลับก่อน
   *
   * รายชื่อพนักงานเริ่มต้นเป็นข้อมูลสมมติของต้นทาง (usr-01..usr-15) แล้ว
   * ServerStoreSync ค่อยดึงรายชื่อจริงจาก core.users มาทับทีหลัง (async)
   * ถ้าสลับตัวตนเป็น UUID จริงทันที จะมีช่วงที่ getUser(uuid) คืน undefined
   * แล้วคอมโพเนนต์ที่เขียน getUser(...)! ไว้จะพังทั้งหน้า
   * — dashboard-hero, new-task-dialog, report-composer เขียนแบบนั้นทั้งสามตัว
   *
   * เจอบนเซิร์ฟเวอร์จริง: /report-task ขึ้น "This page couldn't load"
   * ทั้งที่ SSR ตอบ 200 เพราะตอน SSR ตัวตนยังเป็นค่า default ที่หาเจอ
   * พังตอน useEffect ทำงานหลัง hydrate เท่านั้น curl จึงจับไม่ได้
   */
  useEffect(() => {
    const store = useEmployeeStore.getState();
    if (!store.employees.some((e) => e.id === currentUser.id)) {
      // setState, not setEmployees — this is just a stopgap so getUser(me)
      // resolves before the real directory lands; it must not flip `loaded`,
      // or the demo seed would be treated as the real employee list.
      useEmployeeStore.setState((s) => ({ employees: [...s.employees, currentUser] }));
    }
    useIdentityStore.getState().setViewingAs(currentUser.id);
  }, [currentUser]);

  // เลือกเมนูที่ path ยาวที่สุดที่ยังเป็นคำนำหน้าของ pathname
  // ⇒ หน้าลูก (ถ้ามีในอนาคต) ยังได้ชื่อของหมวดตัวเอง ไม่ตกไปใช้ชื่อแดชบอร์ด
  const match = reportTaskManifest.menus
    .filter((m) => pathname === m.path || pathname.startsWith(`${m.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];

  // "แจ้งบัค" (/issue-reports) เป็นโมดูลของตัวเอง (issue-report-self-manifest.ts)
  // ไม่ใช่เมนูของรายงานและงาน แต่ใช้ scaffold นี้ห่อ (ข้อมูลตั๋วอยู่ใน store
  // ของ report_task) จึงไม่มีเมนูของ reportTaskManifest ให้ match — ตั้งชื่อ
  // หัวหน้าจอแยกไว้ตรงนี้ ไม่งั้นจะตกไปใช้ชื่อ "รายงานและงาน"
  const isIssueReports = pathname.startsWith(ISSUE_REPORTS_BASE);

  const title = isIssueReports ? "แจ้งบัค" : (match?.label ?? reportTaskManifest.name);
  // หน้ารายละเอียดตั๋ว (/issue-reports/[id]) มีลูกศรย้อนกลับที่มุมซ้ายของแถบบน กลับไปหน้ารายการ
  const backHref = pathname.startsWith(`${ISSUE_REPORTS_BASE}/`) ? ISSUE_REPORTS_BASE : undefined;

  // กระดาน Kanban กับหน้ารายงาน (topic sidebar + feed สองแผงเลื่อนแยกกันเอง
  // ข้างใน) จัดการ scroll ของตัวเองทั้งคู่ — ถ้าไม่ตั้ง fill ไว้ ตัวห่อของ
  // AppScaffold จะไม่มีความสูงที่แน่นอนให้ `h-full`/`min-h-0` ข้างในอิง จึง
  // ยุบเหลือแค่ความสูงเนื้อหาแล้วดันให้ทั้งหน้าเว็บเลื่อนแทน — เจอจริงที่หน้า
  // รายงาน: แทนที่แผงหัวข้อ/ฟีดโพสต์จะเลื่อนอยู่ในกรอบตัวเอง กลับกลายเป็น
  // ทั้งหน้าเลื่อนยาวเป็นพรืด ("มีเยอะๆเลื่อนหาตายเลย")
  const isBoard = pathname.startsWith(`${REPORT_TASK_BASE}/tasks`);
  const isReportFeed = pathname.startsWith(`${REPORT_TASK_BASE}/report-feed`);
  // แชทก็เหมือนกัน — รายการห้องกับข้อความเลื่อนในกรอบตัวเอง กรอบต้องสูงเต็มจอ
  // ไม่ใช่ยุบตามเนื้อหา ("ใน pc อยากให้เห็นเต็มหน้า ... ให้เลื่อนไปแค่ชื่อกับแชท")
  const isChat = pathname.startsWith(`${REPORT_TASK_BASE}/chat`);
  const selfScrolling = isBoard || isReportFeed || isChat;

  return (
    <AppBarLeadingProvider>
      {/* ตัวเติมข้อมูลให้ store ฝั่ง client — ต้องอยู่ระดับโมดูล ไม่ใช่รายหน้า
          ไม่งั้นจะโหลดใหม่ทุกครั้งที่เปลี่ยนหน้า */}
      <StoreHydrator />
      <TaskSync />
      <TourOverlay />
      {/* <Toaster /> ย้ายไปอยู่ที่ Shell แล้ว (components/shell/shell.tsx) — ครอบทุกโมดูล
          ห้ามวางซ้ำที่นี่ ไม่งั้นทุก toast ในโมดูลนี้จะเด้งขึ้นสองอัน */}

      <ScaffoldBody title={title} selfScrolling={selfScrolling} backHref={backHref}>
        {children}
      </ScaffoldBody>
    </AppBarLeadingProvider>
  );
}

/** Split out from ReportTaskScaffold so `useAppBarLeading()` reads the
 * context value from inside AppBarLeadingProvider, not the same component
 * that renders the provider itself. */
function ScaffoldBody({
  title,
  selfScrolling,
  backHref,
  children,
}: {
  title: string;
  selfScrolling: boolean;
  backHref?: string;
  children: React.ReactNode;
}) {
  const leading = useAppBarLeading();
  return (
    <AppScaffold title={title} leading={leading} backHref={backHref} width="max-w-none" fill={selfScrolling} fillMaxWidth={selfScrolling}>
      {children}
    </AppScaffold>
  );
}
