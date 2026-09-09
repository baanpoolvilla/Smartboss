import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type Paged,
  type Site,
} from "@/modules/hr/lib/api";
import {
  EmptyState,
  NotProvisioned,
  SectionCard,
} from "@/modules/hr/components/ui";
import { SiteCreateForm, SiteEditCard } from "./site-forms";

export default async function SitesPage() {
  // ไม่ต้องเช็คสิทธิ์ซ้ำที่นี่ — HrPage เด้งออกเองถ้าไม่มี settingManage
  return (
    <HrPage
      title="สถานที่ทำงาน"
      permission={HR_PERMS.settingManage}
      load={async () => {
        const [sites, companies] = await Promise.all([
          wfFetch<Paged<Site>>("/sites"),
          // คนที่ตั้งค่าได้อาจไม่มีสิทธิ์อ่านทะเบียนนิติบุคคล — ปล่อยให้ 403
          // ล้มทั้งหน้าจะทำให้เข้าหน้านี้ไม่ได้เลย
          wfTry<Paged<Company>>("/companies"),
        ]);
        const companyId = companies?.items[0]?.id;

        // companies = null คือไม่มีสิทธิ์อ่าน ไม่ใช่ยังไม่ถูกตั้งต้น — คนละเรื่องกัน
        if (companies !== null && companyId === undefined) {
          return <NotProvisioned what="ตั้งค่าสถานที่ทำงาน" />;
        }

        const withoutPin = sites.items.filter(
          (site) => site.latitude === null || site.longitude === null,
        ).length;

        return (
          <div className="space-y-4">
            <SectionCard
              title="ทำไมหน้านี้สำคัญ"
              description="พิกัดกับรัศมีที่ตั้งไว้ที่นี่คือตัวตัดสินว่าการลงเวลาด้วยมือถือของพนักงานผ่านหรือไม่ผ่าน"
            >
              <ul className="ml-4 list-disc space-y-1 text-sm text-(--ink-soft)">
                <li>
                  พนักงานลงเวลาแล้วระบบจะหาไซต์ที่ใกล้ที่สุด แล้วเทียบระยะกับรัศมีของไซต์นั้น
                </li>
                <li>
                  ไซต์ที่ <strong className="text-(--ink)">ไม่มีหมุด</strong>{" "}
                  ใช้ลงเวลาแบบ check-in ไม่ได้ — ระบบไม่มีอะไรให้เทียบระยะ
                </li>
                <li>
                  เว้นรัศมีว่างไว้ = ใช้ค่าจากนโยบายของกลุ่มพนักงาน
                  (ตั้งรัศมีที่ไซต์จะทับค่าของนโยบาย)
                </li>
                <li>
                  ตั้งรัศมีให้กว้างกว่าความแม่นของ GPS ที่หน้างานจริง — ในอาคารหรือ
                  ตึกสูงบังสัญญาณ ความแม่นมักแย่กว่ากลางที่โล่งหลายเท่า
                </li>
              </ul>
            </SectionCard>

            {companyId && (
              <SectionCard
                title="เพิ่มสถานที่"
                description="ยืนอยู่ที่สถานที่นั้นแล้วกด “ใช้ตำแหน่งปัจจุบัน” ได้เลย ไม่ต้องไปหาพิกัดจากแผนที่"
              >
                <SiteCreateForm companyId={companyId} />
              </SectionCard>
            )}

            <SectionCard
              title={`สถานที่ทั้งหมด (${sites.items.length})`}
              description={
                withoutPin > 0
                  ? `มี ${withoutPin} แห่งที่ยังไม่มีหมุด — ลงเวลาด้วยมือถือที่นั่นยังไม่ได้`
                  : undefined
              }
            >
              {sites.items.length === 0 ? (
                <EmptyState>
                  ยังไม่มีสถานที่ทำงาน — เพิ่มที่แรกก่อน แล้วพนักงานจะเริ่มลงเวลาด้วยมือถือได้
                </EmptyState>
              ) : (
                <div className="space-y-3">
                  {sites.items.map((site) => (
                    <SiteEditCard key={site.id} site={site} />
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        );
      }}
    />
  );
}
