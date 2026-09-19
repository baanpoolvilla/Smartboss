"use server";

import { requireOrg } from "@smartboss/auth";
import { notifyUser } from "@/modules/maintenance/data/notify";
import { listUsersAcrossOrgs } from "@/modules/admin/data/users";

/**
 * แจ้งเตือนข้ามบริษัทของระบบ "แจ้งบัค" — เรียกควบคู่ (ไม่ใช่แทนที่) การเขียน
 * store ฝั่ง client เดิม (addTicket/addMessage ใน issue-report-store.ts,
 * เขียนจริงผ่าน ServerStoreSync เหมือนเดิมทุกอย่าง) fire-and-forget จากหน้า
 * ที่ผู้แจ้งเห็น — ห่อ try/catch เองทั้งคู่ ไม่ให้การแจ้งเตือนพังแล้วทำให้การ
 * แจ้งปัญหา/การตอบจริงที่ผู้ใช้กำลังรอผลอยู่พังตามไปด้วย
 *
 * รับข้อมูลตั๋วเป็นพารามิเตอร์ตรง ๆ จากผู้เรียก (ไม่ readStore มาหาเองที่นี่)
 * ตั้งใจ — ตั๋ว/ข้อความเพิ่งเขียนลง client store ยังไม่ทันถูก sync ขึ้นเซิร์ฟเวอร์
 * จริง (ServerStoreSync debounce 500ms) ถ้ามาอ่านซ้ำตรงนี้จะมีโอกาสเจอข้อมูล
 * เก่าที่ยังไม่มีตั๋ว/ข้อความที่เพิ่งเพิ่มไปเลย (race condition) — ผู้เรียกมี
 * ข้อมูลที่ต้องใช้อยู่ในมืออยู่แล้วทั้งหมด (เพิ่งสร้าง/มี ticket เป็น prop)
 * ส่งตรงมาปลอดภัยกว่า
 *
 * ใช้ listUsersAcrossOrgs() ตรงๆ ไม่ใช่ listSuperAdmins() ของ
 * issue-ticket-actions.ts — อันนั้นเช็ค requireSuperAdmin() ของ**ผู้เรียก**
 * ก่อนเสมอ (ถูกแล้วสำหรับใช้เติม dropdown มอบหมายงานในหน้าแอดมิน) แต่ที่นี่
 * ผู้เรียกคือพนักงานทั่วไปที่เพิ่งแจ้งปัญหา ไม่ใช่ Super Admin เอง — ต้องมี
 * เวอร์ชันที่ไม่เช็คสิทธิ์ผู้เรียกแยกต่างหาก (แค่ใช้หา "ใครคือ Super Admin"
 * เพื่อส่งแจ้งเตือนให้ ไม่ได้ให้สิทธิ์อะไรเพิ่ม)
 */
async function superAdminIds(): Promise<string[]> {
  const all = await listUsersAcrossOrgs();
  return all.filter((u) => u.hasSystemRole && u.isActive).map((u) => u.id);
}

/** มีคนแจ้งบัคใหม่ — แจ้งทีม Smartboss (Super Admin) ทุกคนที่ยังใช้งานอยู่
 * ตอนนี้ ลิงก์พาไปหน้าคอนโซลข้ามบริษัทของทีม (/admin/issue-reports) ตรง ๆ
 * (ดู derive.ts's maintenanceHrefFor สำหรับรูปแบบ referenceId "orgId:ticketId") */
export async function notifyNewIssueTicket(ticketId: string, title: string, description: string): Promise<void> {
  try {
    const session = await requireOrg();
    const admins = await superAdminIds();
    await Promise.all(
      admins.map((id) =>
        notifyUser(session.orgId, id, {
          title: `มีแจ้งบัคใหม่: "${title}"`,
          body: description || undefined,
          type: "issue_ticket_new",
          referenceId: `${session.orgId}:${ticketId}`,
        })
      )
    );
  } catch (err) {
    console.error("[issue-notify] notifyNewIssueTicket failed", err);
  }
}

/** ผู้แจ้งพิมพ์ตอบในตั๋วของตัวเอง (หน้านี้ไม่มีแท็บ "โน้ตภายใน" ให้เลือกเลย —
 * ข้อความที่ส่งได้จากที่นี่เห็นได้ทั้งคู่เสมอ) แจ้งคนที่รับผิดชอบตั๋วนี้อยู่ —
 * ถ้ายังไม่มีใครรับ แจ้ง Super Admin ทุกคนแทน จะได้ไม่มีใครพลาดตั๋วที่ยังไม่มี
 * เจ้าของ */
export async function notifyIssueReplyFromReporter(ticketId: string, ticketTitle: string, assigneeId: string | null): Promise<void> {
  try {
    const session = await requireOrg();
    const recipients = assigneeId ? [assigneeId] : await superAdminIds();
    await Promise.all(
      recipients.map((id) =>
        notifyUser(session.orgId, id, {
          title: `ผู้แจ้งตอบกลับตั๋ว "${ticketTitle}"`,
          type: "issue_ticket_new",
          referenceId: `${session.orgId}:${ticketId}`,
        })
      )
    );
  } catch (err) {
    console.error("[issue-notify] notifyIssueReplyFromReporter failed", err);
  }
}
