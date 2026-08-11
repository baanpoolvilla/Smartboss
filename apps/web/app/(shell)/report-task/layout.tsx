import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { ReportTaskScaffold } from "@/modules/report_task/components/shared/report-task-scaffold";
import type { User } from "@/modules/report_task/types";

/**
 * ตัวห่อระดับโมดูลรายงานและงาน
 *
 * เดิมงานพวกนี้อยู่ใน AppShell ของแอป workspace ที่รันเดี่ยว ๆ (พร้อม sidebar/topbar)
 * ตอนพอร์ตเข้ามา sidebar/topbar เป็นของ shell กลาง เหลือแค่ AppScaffold กับ
 * ตัวเติมข้อมูลให้ store ซึ่งย้ายไปอยู่ใน ReportTaskScaffold ทั้งหมด
 *
 * ส่ง **ตัวผู้ใช้ทั้งก้อน** ลงไป ไม่ใช่แค่ id เพราะฝั่ง client ต้องมีชื่อคนนี้อยู่ใน
 * สมุดรายชื่อตั้งแต่เฟรมแรก ก่อนที่รายชื่อจริงจากเซิร์ฟเวอร์จะโหลดเสร็จ
 * (เหตุผลเต็มอยู่ในคอมเมนต์ของ ReportTaskScaffold)
 */
export const dynamic = "force-dynamic";

/** ตัวย่อสำหรับรูปโปรไฟล์ — ตรรกะเดียวกับ lib/db/employee-directory.ts */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`;
}

export default async function ReportTaskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireOrg();

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      roles: { select: { role: { select: { code: true, name: true } } } },
    },
  });

  const currentUser: User = {
    id: me.id,
    name: me.name,
    email: me.email,
    avatar: initialsOf(me.name),
    role: me.roles[0]?.role.name ?? "พนักงาน",
    // แผนกมาจาก employee-profiles ซึ่งโหลดทีหลังพร้อมรายชื่อจริง
    // ค่าว่างที่นี่แค่ประคองเฟรมแรก ไม่ได้ใช้ตัดสินสิทธิ์อะไร
    departmentId: "",
  };

  return (
    <ReportTaskScaffold currentUser={currentUser}>{children}</ReportTaskScaffold>
  );
}
