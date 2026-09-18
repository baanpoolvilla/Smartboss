import Link from "next/link";
import { requireOrg } from "@smartboss/auth";
import { AppScaffold } from "@/components/module/app-scaffold";
import { SectionCard } from "@/modules/admin/components/ui";
import { buildMyWorkOverview } from "@/modules/report_task/lib/server/my-work-overview";
import { AccountTabs } from "../account-tabs";
import { ClipboardList, Users } from "lucide-react";

/**
 * "งานของฉัน" — แท็บที่สองของ "บัญชีของฉัน" ตอบสองคำถามที่พนักงานใหม่มักไม่รู้
 * จนกว่าจะพลาดสักครั้ง: 1) ต้องส่งรายงานห้องไหนบ้าง วันไหน กี่โมง (คนละเรื่อง
 * กับ "เห็นห้องไหนบ้าง" — ดู my-work-overview.ts) 2) ตอนนี้มีงานค้างอยู่กี่ชิ้น
 * ทั้งที่ตัวเองต้องทำเองและที่ตัวเองมอบหมายให้คนอื่น คร่าวๆ พอให้รู้ว่า "อ๋อ
 * เรามีงานประมาณนี้นะ" ไม่ใช่บอร์ด Kanban เต็มรูปแบบ (กด "ดูทั้งหมด" ไปที่นั่นได้)
 */
export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const session = await requireOrg();
  const overview = await buildMyWorkOverview(session.orgId, session.userId);

  return (
    <AppScaffold title="บัญชีของฉัน" width="max-w-2xl" backHref="/" hideDefaultActions>
      <AccountTabs active="/account/work" />

      <SectionCard
        title="ห้องที่ต้องส่งรายงาน"
        description="ห้องที่คุณมีหน้าที่ส่งจริง พร้อมรอบและเวลา — กดแถวไหนก็ได้เพื่อไปที่ห้องนั้น"
      >
        {overview.reportRooms.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">ยังไม่มีห้องไหนที่คุณต้องส่งรายงานตอนนี้</p>
        ) : (
          <div className="flex flex-col gap-2">
            {overview.reportRooms.map((room) => (
              <Link
                key={room.topicId}
                href={`/report-task/report-feed?topic=${room.topicId}`}
                className="rounded-(--radius) border border-(--line) px-3 py-2.5 transition-colors hover:bg-(--bg-soft)"
              >
                <p className="text-sm font-semibold text-(--ink)"># {room.topicName}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {room.rounds.map((r, i) => (
                    <span key={i} className="text-xs text-(--ink-soft)">
                      {r.label} · {r.when}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-(--ink-soft)">คนลา/วันหยุดตัดออกให้เองอัตโนมัติ ไม่ต้องกังวลว่าจะโดนนับผิด</p>
      </SectionCard>

      <SectionCard title="งานของฉัน" description="สรุปคร่าวๆ ว่าตอนนี้มีงานประมาณไหนอยู่ในมือ" className="mt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-(--radius) bg-(--bg-soft) p-3">
            <div className="flex items-center gap-1.5 text-(--ink-soft)">
              <ClipboardList className="h-3.5 w-3.5" />
              <span className="text-xs">ได้รับมอบหมาย กำลังทำ</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-(--ink)">{overview.assignedToMeCount}</p>
          </div>
          <div className="rounded-(--radius) bg-(--bg-soft) p-3">
            <div className="flex items-center gap-1.5 text-(--ink-soft)">
              <Users className="h-3.5 w-3.5" />
              <span className="text-xs">มอบหมายให้คนอื่น</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-(--ink)">{overview.assignedByMeCount}</p>
          </div>
        </div>

        {overview.assignedToMePreview.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-(--ink-soft) uppercase">กำลังทำอยู่ตอนนี้</p>
            <div className="flex flex-col gap-1.5">
              {overview.assignedToMePreview.map((t) => (
                <Link
                  key={t.id}
                  href={`/report-task/tasks?task=${t.id}`}
                  className="flex items-center justify-between gap-3 rounded-(--radius) border border-(--line) px-3 py-2 text-sm transition-colors hover:bg-(--bg-soft)"
                >
                  <span className="min-w-0 flex-1 truncate text-(--ink)">{t.title}</span>
                  <span className="shrink-0 text-xs text-(--ink-soft)">{t.dueDate}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <Link href="/report-task/tasks" className="mt-3 inline-block text-sm font-semibold text-(--app-strong,var(--ink))">
          ดูงานทั้งหมด ›
        </Link>
      </SectionCard>
    </AppScaffold>
  );
}
