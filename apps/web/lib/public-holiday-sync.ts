import "server-only";
import { prisma } from "@smartboss/database";
import { uuidv7 } from "@workforce/domain";

import { thaiHolidayEvents } from "@/modules/report_task/data/thai-holidays";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import {
  parsePublicHolidays,
  planCompanySync,
  todayInThailand,
  type PublicHoliday,
  type SyncStore,
} from "@/modules/hr/lib/public-holidays";

/**
 * ดึงวันหยุดนักขัตฤกษ์จากปฏิทินวันหยุดของ Google เข้าปฏิทินวันหยุดบริษัท (โมดูลบุคคล) ทุกวัน
 *
 * ทำไม: สิทธิ์ Holiday และวันหยุดในระบบลงเวลานับจากปฏิทินวันหยุดบริษัทของ HR เท่านั้น
 * เดิมต้องมีคนกรอกเองทุกปี พอขึ้นปีใหม่แล้วไม่มีใครกรอก ทุกเดือนได้สิทธิ์ 0 โดยไม่มีอะไรเตือน
 * (เจอจริง: ม.ค. 2570 ไม่ได้ Holiday เพิ่ม) ส่วนรายการในโค้ด (data/thai-holidays.ts) ต้องมาแก้มือ
 * ทุกปีเพราะวันหยุดทางพุทธเลื่อนตามจันทรคติ และวันหยุดชดเชย/วันหยุดพิเศษประกาศทีหลัง
 * Google มีปฏิทินที่อัปเดตให้เอง แบบเดียวกับที่ Google Calendar / Teams ใช้
 *
 * กติกา (ต่อบริษัท):
 *   - ดึงเฉพาะวันที่ Google ระบุว่า "วันหยุดนักขัตฤกษ์" (ไม่เอาวันสำคัญอย่างวาเลนไทน์) รวมวันชดเชย
 *   - เฉพาะวันนี้เป็นต้นไปถึงสิ้นปีหน้า — วันที่ผ่านไปแล้วไม่แตะ (สิทธิ์ย้อนหลังที่ HR ดูแลไว้ไม่เปลี่ยน)
 *   - วันที่เคยเห็นแล้วไม่เพิ่มซ้ำ ⇒ HR ลบวันที่บริษัทไม่ได้ให้ทิ้งได้ ไม่ถูกดึงกลับมา
 *   - วันที่ระบบเพิ่มเองแล้ว Google เอาออก (ย้าย/ยกเลิก) ลบออกให้ — วันที่ HR กรอกเองไม่แตะ
 *
 * ประเทศ: ตอนนี้ทุกบริษัทใช้ไทย ปฏิทินของ Google มีทุกประเทศในรูปแบบเดียวกัน
 * (`th.<ประเทศ>#holiday` = ชื่อวันเป็นภาษาไทย) — เพิ่มประเทศได้ที่ GOOGLE_HOLIDAY_CALENDARS
 */

const GOOGLE_HOLIDAY_CALENDARS: Record<string, string> = {
  TH: "th.th#holiday@group.v.calendar.google.com",
};

const SYNC_STORE_KEY = "public-holiday-sync";

/**
 * ชื่อสั้นที่ปฏิทินเราใช้อยู่แล้ว (เช่น "วันคล้ายวันสวรรคต ร.9") ชนะชื่อเต็มของ Google
 * ที่ยาวเกินช่องและสะกดผิดบางวัน ("วันขื้นปีใหม่") — วันที่ไม่มีในรายการ (วันชดเชย ฯลฯ) ใช้ชื่อของ Google
 */
const shortThaiNames = new Map(thaiHolidayEvents.map((h) => [h.start.slice(0, 10), h.title]));

async function fetchPublicHolidays(country: string): Promise<PublicHoliday[]> {
  const calendarId = GOOGLE_HOLIDAY_CALENDARS[country];
  if (!calendarId) throw new Error(`no holiday calendar for ${country}`);
  const response = await fetch(
    `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`,
    { cache: "no-store", signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok) throw new Error(`Google holiday calendar HTTP ${response.status}`);
  const holidays = parsePublicHolidays(await response.text()).map((h) => ({
    ...h,
    name: (country === "TH" ? shortThaiNames.get(h.date) : undefined) ?? h.name,
  }));
  // กันไฟล์เพี้ยน/ว่างไปลบวันหยุดที่ระบบเคยเพิ่มทิ้งทั้งหมด
  if (holidays.length < 5) throw new Error(`Google holiday calendar returned only ${holidays.length} holidays`);
  return holidays;
}

export interface PublicHolidaySyncResult {
  companies: number;
  added: number;
  removed: number;
  errors: string[];
}

export async function syncPublicHolidays(): Promise<PublicHolidaySyncResult> {
  const result: PublicHolidaySyncResult = { companies: 0, added: 0, removed: 0, errors: [] };
  const google = await fetchPublicHolidays("TH");
  const today = todayInThailand();
  const orgs = await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM core.organizations`;

  for (const org of orgs) {
    try {
      const { data, version } = await readStore<SyncStore>(org.id, SYNC_STORE_KEY);
      const store: SyncStore = { ...(data ?? {}) };
      let changed = false;

      await withWorkforceTenant(org.id, async (tx) => {
        const companies = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM workforce.companies WHERE status = 'ACTIVE'
        `;
        for (const company of companies) {
          result.companies++;
          const existing = await tx.$queryRaw<{ holiday_date: string }[]>`
            SELECT to_char(hd.holiday_date, 'YYYY-MM-DD') AS holiday_date
            FROM workforce.holiday_dates hd
            JOIN workforce.holiday_calendars hc ON hc.id = hd.calendar_id
            WHERE hc.company_id = ${company.id}::uuid AND hd.holiday_date >= ${today}::date
          `;
          const plan = planCompanySync(google, new Set(existing.map((r) => r.holiday_date)), store[company.id], today);

          if (plan.insert.length > 0) {
            // ปฏิทินใบเดียวของบริษัท — ยังไม่มีก็สร้าง (เหมือน mainHolidayCalendarId ใน hr/actions.ts)
            let calendarId = (
              await tx.$queryRaw<{ id: string }[]>`
                SELECT id::text AS id FROM workforce.holiday_calendars
                WHERE company_id = ${company.id}::uuid ORDER BY created_at LIMIT 1
              `
            )[0]?.id;
            if (!calendarId) {
              calendarId = uuidv7();
              await tx.$executeRaw`
                INSERT INTO workforce.holiday_calendars (id, tenant_id, company_id, code, name)
                VALUES (${calendarId}::uuid, ${org.id}::uuid, ${company.id}::uuid, 'MAIN', 'วันหยุดบริษัท')
              `;
            }
            for (const h of plan.insert) {
              await tx.$executeRaw`
                INSERT INTO workforce.holiday_dates (id, tenant_id, calendar_id, holiday_date, name, paid)
                VALUES (${uuidv7()}::uuid, ${org.id}::uuid, ${calendarId}::uuid, ${h.date}::date, ${h.name}, true)
                ON CONFLICT (calendar_id, holiday_date) DO NOTHING
              `;
            }
            result.added += plan.insert.length;
          }

          for (const date of plan.remove) {
            await tx.$executeRaw`
              DELETE FROM workforce.holiday_dates hd
              USING workforce.holiday_calendars hc
              WHERE hc.id = hd.calendar_id AND hc.company_id = ${company.id}::uuid
                AND hd.holiday_date = ${date}::date
            `;
          }
          result.removed += plan.remove.length;

          if (JSON.stringify(store[company.id]) !== JSON.stringify(plan.state)) {
            store[company.id] = plan.state;
            changed = true;
          }
        }
      });

      if (changed) await writeStore(org.id, SYNC_STORE_KEY, store, data === null ? null : version);
    } catch (error) {
      console.error("[public-holiday-sync]", org.id, error);
      result.errors.push(`${org.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
