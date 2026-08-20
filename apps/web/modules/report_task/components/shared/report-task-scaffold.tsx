"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { AppScaffold } from "@/components/module/app-scaffold";

import { REPORT_TASK_BASE } from "../../constants";
import { reportTaskManifest } from "../../manifest";
import { useEmployeeStore } from "../../store/employee-store";
import { useIdentityStore } from "../../store/identity-store";
import type { User } from "../../types";
import { StoreHydrator } from "./store-hydrator";
import { TaskSync } from "./task-sync";
import { TourOverlay } from "./tour-overlay";
import { Toaster } from "../ui/sonner";

/**
 * ครอบทุกหน้าของโมดูลด้วย AppScaffold ตัวเดียวกับ maintenance / hr / admin
 *
 * ทำที่ layout ที่เดียวแทนที่จะไปแก้ทั้ง 8 หน้า เพราะทุกหน้าของโมดูลนี้เป็น
 * หน้าระดับบนสุดเหมือนกันหมด (ไม่มีหน้ารายละเอียดที่ต้องมีปุ่มย้อนกลับ)
 * ชื่อหัวข้อดึงจาก manifest ตาม pathname จะได้ไม่ต้องเขียนชื่อซ้ำสองที่
 *
 * width กว้างกว่าโมดูลอื่นเพราะมีบอร์ด Kanban กับปฏิทินที่ต้องใช้พื้นที่
 * (ของเดิมใน workspace ก็ใช้ max-w-[1600px])
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
      store.setEmployees([...store.employees, currentUser]);
    }
    useIdentityStore.getState().setViewingAs(currentUser.id);
  }, [currentUser]);

  // เลือกเมนูที่ path ยาวที่สุดที่ยังเป็นคำนำหน้าของ pathname
  // ⇒ หน้าลูก (ถ้ามีในอนาคต) ยังได้ชื่อของหมวดตัวเอง ไม่ตกไปใช้ชื่อแดชบอร์ด
  const match = reportTaskManifest.menus
    .filter((m) => pathname === m.path || pathname.startsWith(`${m.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];

  const title = match?.label ?? reportTaskManifest.name;

  // กระดาน Kanban จัดการ scroll เอง จึงให้เต็มพื้นที่แทนที่จะจำกัดความกว้าง
  const isBoard = pathname.startsWith(`${REPORT_TASK_BASE}/tasks`);

  return (
    <>
      {/* ตัวเติมข้อมูลให้ store ฝั่ง client — ต้องอยู่ระดับโมดูล ไม่ใช่รายหน้า
          ไม่งั้นจะโหลดใหม่ทุกครั้งที่เปลี่ยนหน้า */}
      <StoreHydrator />
      <TaskSync />
      <TourOverlay />
      {/* ตัวแสดงผล toast.success/error/... ที่เรียกกันทั่วทั้งโมดูล — เดิมไม่มี
          <Toaster /> วางไว้ที่ไหนเลยสักหน้า เรียก toast(...) แล้วเงียบไปเฉยๆ
          ไม่มีอะไรขึ้นบนจอ. closeButton — กดปิดข้อความได้เอง ไม่ต้องรอหมดเวลา
          (สำคัญกับ error ที่มีเนื้อหายาวอย่าง "ยังติ๊ก checklist ไม่ครบ...") */}
      <Toaster position="top-center" closeButton />

      <AppScaffold title={title} width="max-w-[1600px]" fill={isBoard} fillMaxWidth={isBoard}>
        {children}
      </AppScaffold>
    </>
  );
}
