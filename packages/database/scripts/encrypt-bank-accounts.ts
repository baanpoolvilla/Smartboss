import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * เข้ารหัสเลขบัญชีธนาคารที่ยังเก็บเป็นข้อความธรรมดา (ของเดิมก่อน 11/11/2569)
 *   - เลขบัญชีรับเงินเดือนของพนักงาน      salary.profiles.bank_account
 *   - เลขบัญชีที่ติดไปกับรอบจ่าย           salary.run_lines.bank_account
 *   - เลขบัญชีบริษัทที่ใช้จ่ายเงินเดือน      salary.settings.pay_bank_account
 *   - เลขบัญชีช่าง/ร้าน (เบิกจ่าย & OT)   requests.vendors.bank_account
 *
 * ไม่รันก็ไม่เสียอะไร: ระบบอ่านได้ทั้งแบบเข้ารหัสและไม่เข้ารหัส และเข้ารหัสเองทุกครั้งที่มีการบันทึกใหม่
 * (packages/database/field-crypto.ts) สคริปต์นี้แค่ทำของเก่าให้ครบทีเดียว
 *
 * ต้องมี FIELD_ENCRYPTION_KEY ใน env (ตัวเดียวกับที่ระบบบุคคลใช้เข้ารหัสเลขบัตรประชาชน)
 * ⚠ กุญแจหาย = อ่านเลขบัญชีไม่ได้อีก — สำรองกุญแจไว้นอกเครื่องก่อนรัน และสำรองฐานข้อมูลก่อน
 *
 * ปลอดภัย รันซ้ำได้: แตะเฉพาะแถวที่ยังไม่ขึ้นต้น "enc:v1:"
 *
 * รัน:  pnpm --filter @smartboss/database exec tsx scripts/encrypt-bank-accounts.ts --dry-run   (ดูจำนวนก่อน)
 *       pnpm --filter @smartboss/database exec tsx scripts/encrypt-bank-accounts.ts             (ทำจริง)
 * บนเครื่องจริงโหลด env ก่อน:  set -a; . /etc/smartboss/smartboss.env; set +a
 */

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const dryRun = process.argv.includes("--dry-run");

const TARGETS = [
  { label: "เลขบัญชีพนักงาน", table: `"salary"."profiles"`, column: "bank_account", key: ["org_id", "employment_id"] },
  { label: "เลขบัญชีในรอบจ่าย", table: `"salary"."run_lines"`, column: "bank_account", key: ["id"] },
  { label: "เลขบัญชีบริษัท", table: `"salary"."settings"`, column: "pay_bank_account", key: ["org_id"] },
  { label: "เลขบัญชีช่าง/ร้าน", table: `"requests"."vendors"`, column: "bank_account", key: ["id"] },
] as const;

async function main() {
  // import หลังโหลด env — ตัวเข้ารหัสอ่านกุญแจจาก process.env ตอนใช้งานครั้งแรก
  const { fieldEncryptionConfigured, sealField, openField } = await import("../field-crypto");
  if (!fieldEncryptionConfigured()) {
    console.error("ไม่พบ FIELD_ENCRYPTION_KEY (base64 ของ 32 ไบต์) ใน env — ยังไม่ได้ทำอะไร");
    process.exit(1);
  }
  // ทดสอบกุญแจไป-กลับก่อนแตะข้อมูลจริง
  if (openField(sealField("1234567890")) !== "1234567890") {
    console.error("กุญแจเข้ารหัสใช้ไม่ได้ (เข้ารหัสแล้วถอดกลับไม่ตรง) — ยังไม่ได้ทำอะไร");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    let total = 0;
    for (const org of orgs) {
      for (const t of TARGETS) {
        const done = await prisma.$transaction(
          async (tx) => {
            // สวมบทเดียวกับที่แอปใช้ (RLS ของ salary/requests) — เห็นและแก้ได้เฉพาะแถวของบริษัทนี้
            await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
            await tx.$executeRaw`SELECT set_config('salary.org_id', ${org.id}, true)`;
            await tx.$executeRaw`SELECT set_config('requests.org_id', ${org.id}, true)`;
            const cols = [...t.key, t.column].map((c) => `"${c}"::text AS "${c}"`).join(", ");
            const rows = await tx.$queryRawUnsafe<Record<string, string>[]>(
              `SELECT ${cols} FROM ${t.table} WHERE "org_id" = $1 AND "${t.column}" <> '' AND "${t.column}" NOT LIKE 'enc:v1:%'`,
              org.id,
            );
            if (dryRun) return rows.length;
            for (const row of rows) {
              const where = t.key.map((k, i) => `"${k}"::text = $${i + 2}`).join(" AND ");
              await tx.$executeRawUnsafe(
                `UPDATE ${t.table} SET "${t.column}" = $1 WHERE ${where}`,
                sealField(row[t.column]!),
                ...t.key.map((k) => row[k]!),
              );
            }
            return rows.length;
          },
          { timeout: 120_000 },
        );
        if (done > 0) console.log(`${org.name} · ${t.label}: ${done} แถว${dryRun ? " (จะเข้ารหัส)" : " เข้ารหัสแล้ว"}`);
        total += done;
      }
    }
    console.log(dryRun ? `รวม ${total} แถวที่ยังไม่ได้เข้ารหัส — รันอีกครั้งโดยไม่ใส่ --dry-run เพื่อทำจริง` : `เสร็จ — เข้ารหัส ${total} แถว`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
