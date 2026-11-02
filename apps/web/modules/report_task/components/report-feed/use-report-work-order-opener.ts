"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  WORK_ORDER_DESCRIPTION_MAX,
  WORK_ORDER_PREFILL_KEY,
  WORK_ORDER_TITLE_MAX,
  type WorkOrderPrefill,
} from "@/modules/maintenance/lib/report-prefill";
import { getUser } from "@/modules/report_task/lib/directory";
import { buildReportTaskPrefill } from "@/modules/report_task/lib/report-task-prefill";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import type { ReportPost, ReportPostReply, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useWorkOrderAccessStore } from "@/modules/report_task/store/work-order-access-store";

const MAX_IMAGES = 10;

/**
 * "เปิดใบแจ้งซ่อม" จากโพสต์/ความคิดเห็นในรีพอต (ผู้ใช้ 2/11/2569)
 * พาไปหน้าสร้างใบงานเดิมของโมดูลแจ้งซ่อม พร้อมเติมหัวข้อ รายละเอียด และรูปให้ ผู้ใช้เลือกบ้านแล้วกดสร้างเอง
 */
export function useReportWorkOrderOpener(topic: ReportTopic) {
  const router = useRouter();
  const canOpen = useWorkOrderAccessStore((s) => s.canOpen);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  function open(post: ReportPost, reply?: ReportPostReply) {
    const base = buildReportTaskPrefill({
      topic,
      post,
      reply,
      meId: viewingAsUserId,
      nameOf: (id) => getUser(id)?.name,
      isKnownUser: (id) => !!getUser(id),
    });
    const images = (reply ? (reply.images ?? []) : post.images)
      .filter((img) => !img.sticker && !!img.url && !img.mime?.startsWith("video/"))
      .slice(0, MAX_IMAGES)
      .map((img) => ({ url: img.url!, name: img.name, mime: img.mime }));
    const prefill: WorkOrderPrefill = {
      title: base.title.slice(0, WORK_ORDER_TITLE_MAX),
      description: base.description.slice(0, WORK_ORDER_DESCRIPTION_MAX),
      images,
      source: { label: base.source.label, link: base.source.link },
    };
    try {
      sessionStorage.setItem(WORK_ORDER_PREFILL_KEY, JSON.stringify(prefill));
    } catch {
      toast.error("เติมข้อมูลจากรีพอตไม่ได้ กรุณากรอกในหน้าสร้างใบงานเอง");
    }
    router.push("/maintenance/work-orders/new?fromReport=1");
  }

  return { canOpen, open };
}
