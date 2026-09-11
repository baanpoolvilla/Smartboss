import "server-only";
import { prisma } from "@smartboss/database";
import { isSuperAdmin, type OrgSession } from "@smartboss/auth";
import { setWorkforcePrincipalStatus, syncWorkforcePrincipal } from "@/lib/workforce-provisioning";

/**
 * แยกออกมาจาก app/(shell)/admin/actions.ts (ไฟล์ "use server" — export อะไร
 * จากที่นั่นกลายเป็น server action ที่เรียกตรงจากฝั่ง client ได้ทันที ไม่เหมาะ
 * เอาไว้แค่ export ให้เทสต์เรียกได้) ทั้งสองฟังก์ชันนี้เป็นจุดรวมความไว้ใจ
 * (concentration of trust) ที่เจอจาก tenant-isolation audit — SUPER_ADMIN
 * branch ของ assertManageableUser ข้าม org filter โดยตั้งใจ และ
 * syncUserToWorkforce ไม่มี defense-in-depth ของตัวเองเลย พึ่ง caller
 * validate มาก่อนล้วนๆ — ปักพฤติกรรมไว้ด้วยเทสต์ที่
 * apps/web/modules/admin/data/__tests__/user-guards.test.ts กันเผลอถอย
 */

/** user ที่ session นี้ "จัดการได้" — SUPER_ADMIN ข้าม org ได้ตั้งใจ คนอื่นถูก
 * ล็อกที่บริษัทตัวเองเสมอ (โยน error ถ้า user เป็นของบริษัทอื่น) */
export async function assertManageableUser(session: OrgSession, userId: string) {
  const user = isSuperAdmin(session)
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ where: { id: userId, orgId: session.orgId } });
  if (!user) throw new Error("ไม่พบผู้ใช้ที่จัดการได้");
  return user;
}

/**
 * ซิงก์ user คนหนึ่งเข้าโมดูลบุคคล (workforce) — เรียกหลังสร้าง/แก้/ลบ user
 *
 * `expectedOrgId` คือกำแพงชั้นสอง (defense-in-depth) — ผู้เรียกต้อง
 * assertManageableUser(session, userId) มาก่อนเสมออยู่แล้ว (ทุก caller ทำแบบ
 * นั้น) แต่ฟังก์ชันนี้เองไม่เคยเช็คซ้ำมาก่อน เป็นจุดรวมความไว้ใจที่เจอจาก
 * tenant-isolation audit: caller ในอนาคตที่ลืม validate ก่อนเรียก จะซิงก์
 * user ข้ามบริษัทเข้า workforce ได้เงียบๆ โดยไม่มีอะไรจับ — เช็คนี้ทำให้
 * เรียกด้วย userId ที่ orgId จริงไม่ตรงกับที่คาดไว้แล้ว "ไม่ทำงาน" แทนที่จะ
 * เงียบๆ ซิงก์ไปตาม orgId จริงของ user (ดู __tests__/tenant-isolation/
 * user-guards.test.ts ที่ปักพฤติกรรมนี้ไว้)
 */
export async function syncUserToWorkforce(
  userId: string,
  expectedOrgId: string,
  actorId: string
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        orgId: true,
        name: true,
        email: true,
        isActive: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
    // ผู้ใช้ระดับแพลตฟอร์ม (orgId = null) ไม่มี tenant ให้ผูก — ข้ามไปโดยตั้งใจ
    if (!user?.orgId) return;
    // orgId ไม่ตรงกับที่ caller คาดไว้ = สัญญาณว่าไม่ได้ validate มาก่อน — log
    // ไว้ให้เห็น ไม่ใช่เงียบสนิท ถึงจะไม่ throw ก็ตาม (กันเผลอถอยแบบไม่มีใครรู้)
    if (user.orgId !== expectedOrgId) {
      console.error(
        "[workforce] syncUserToWorkforce: expectedOrgId ไม่ตรงกับ orgId จริงของ user — ข้าม sync",
        { userId, expectedOrgId, actualOrgId: user.orgId }
      );
      return;
    }

    await syncWorkforcePrincipal({
      orgId: user.orgId,
      userId: user.id,
      displayName: user.name,
      email: user.email,
      roleCodes: user.roles.map((r) => r.role.code),
      permissionCodes: user.roles.flatMap((r) =>
        r.role.permissions.map((p) => p.permission.code)
      ),
      actorId,
    });

    // ตั้งสถานะทุกครั้ง ไม่ใช่เฉพาะตอนปิด — ไม่งั้นการเปิดบัญชีคืนจะไม่คืนสิทธิ์
    // ฝั่งโมดูลบุคคล คนนั้นจะยังเข้าไม่ได้ทั้งที่หน้าจอบอกว่าเปิดใช้งานแล้ว
    await setWorkforcePrincipalStatus(user.orgId, user.id, user.isActive, actorId);
  } catch (err) {
    console.error("[workforce] sync principal failed:", userId, err);
  }
}
