import { prisma } from "@smartboss/database";
import { wfFetch, type Paged, type Person } from "./api";

/**
 * เขียนชื่อที่แสดงกลับไปที่บัญชีผู้ใช้ Smartboss (core.users.name)
 *
 * ชื่อคนในระบบมีสองแหล่งที่ไม่ได้ผูกกันโดยธรรมชาติ:
 *   - ทะเบียนพนักงานฝั่ง workforce — แยกช่อง ชื่อ/นามสกุล/ชื่อเล่น ประกอบตามรูปแบบที่บริษัทเลือก
 *   - บัญชีผู้ใช้ core.users.name — ข้อความก้อนเดียว ที่แชท บอร์ดงาน รายงาน และแจ้งเตือนใช้
 *
 * เจ้าของสั่งว่ารูปแบบชื่อต้องมีผลทั้งระบบ ⇒ หลังแก้ชื่อหรือเปลี่ยนรูปแบบ ต้องเขียน
 * ค่าที่ประกอบแล้วทับ core.users.name ให้ด้วย ไม่งั้นแชทยังเรียกชื่อเก่าอยู่
 *
 * จับคู่ด้วย **อีเมล** ค่าเดียวที่ทั้งสองระบบมีและไม่ซ้ำ (ตัวเดียวกับที่ระบบคะแนน
 * และ provisionPrincipal ใช้) — คนที่ไม่มีอีเมลในทะเบียน หรือมีบัญชีแต่ไม่มีทะเบียน
 * พนักงาน (เช่นแอดมินระบบ) จะไม่ถูกแตะ ซึ่งถูกต้อง: ไม่มีชื่อแยกช่องให้ประกอบ
 */

/** อัปเดตบัญชีผู้ใช้คนเดียว — ใช้ตอนแก้ชื่อพนักงานทีละคน */
export async function syncUserName(
  orgId: string,
  email: string | null,
  displayName: string,
): Promise<void> {
  const target = email?.trim();
  if (!target || displayName.trim() === "") return;

  await prisma.user.updateMany({
    where: { orgId, email: { equals: target, mode: "insensitive" } },
    data: { name: displayName.trim() },
  });
}

/**
 * อัปเดตทุกคนในบริษัท — ใช้ตอนเปลี่ยน "รูปแบบชื่อที่แสดง" ซึ่งกระทบทุกคนพร้อมกัน
 *
 * ต้องเรียก **หลัง** บันทึกรูปแบบใหม่แล้วเท่านั้น เพราะอ่าน display_name ที่ API
 * ประกอบมาให้ (ไม่ประกอบเองซ้ำอีกฝั่ง — มีสูตรเดียวใน @workforce/domain)
 *
 * คืนจำนวนบัญชีที่ชื่อเปลี่ยนจริง เพื่อบอกผู้ใช้ว่ามีผลกี่คน
 */
export async function syncAllUserNames(orgId: string): Promise<number> {
  const people: Person[] = [];
  let cursor: string | null | undefined;

  // ไล่ทุกหน้า — บริษัทที่คนเกินหนึ่งหน้าจะซิงก์ไม่ครบถ้าอ่านแค่หน้าแรก
  // (จำกัดรอบไว้กันหลุดเป็นลูปไม่รู้จบถ้า API ตอบ cursor เดิมซ้ำ)
  for (let page = 0; page < 100; page += 1) {
    const query: string = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const batch = await wfFetch<Paged<Person>>(`/people${query}`);
    people.push(...batch.items);
    cursor = batch.next_cursor;
    if (!cursor) break;
  }

  let changed = 0;
  for (const person of people) {
    const email = person.email?.trim();
    if (!email || person.display_name.trim() === "") continue;

    const result = await prisma.user.updateMany({
      where: {
        orgId,
        email: { equals: email, mode: "insensitive" },
        // ไม่เขียนทับแถวที่ชื่อตรงอยู่แล้ว — updatedAt จะขยับทั้งบริษัทโดยไม่มีอะไรเปลี่ยน
        name: { not: person.display_name.trim() },
      },
      data: { name: person.display_name.trim() },
    });
    changed += result.count;
  }

  return changed;
}
