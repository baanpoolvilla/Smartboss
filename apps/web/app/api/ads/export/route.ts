import { adsRoute } from "@/modules/ads/data/access";
import { getAiReport } from "@/modules/ads/data/ai";
import { reportToXlsx } from "@/modules/ads/data/export";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/ads/export?report_id=&format=pdf|xlsx — ส่งออกรายงาน
 *   xlsx → ไฟล์ Excel
 *   pdf  → หน้าพิมพ์ของรายงาน ที่เปิดหน้าต่าง "บันทึกเป็น PDF" ของเบราว์เซอร์ให้เอง
 *          (เบราว์เซอร์จัดวางภาษาไทยได้ถูกต้องครบ ต่างจากไลบรารีสร้าง PDF ฝั่งเซิร์ฟเวอร์)
 */
export const GET = adsRoute(ADS_PERMS.access, async (req, session) => {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("report_id") ?? "";
  const format = sp.get("format");
  const report = await getAiReport(session.orgId, id);
  if (!report) return Response.json({ error: "ไม่พบรายงานนี้" }, { status: 404 });

  if (format === "pdf") {
    return Response.redirect(new URL(`/ads/reports/${report.id}/print`, req.url), 303);
  }
  if (format !== "xlsx") throw new Error("format ต้องเป็น pdf หรือ xlsx");

  const buf = await reportToXlsx(report);
  const filename = `google-ads-${report.customerId}-${report.period.from}_${report.period.to}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
