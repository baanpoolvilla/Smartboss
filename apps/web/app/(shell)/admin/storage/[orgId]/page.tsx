import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold } from "@/components/module/app-scaffold";
import { EmptyState } from "@/modules/admin/components/ui";
import { getStorageBreakdown } from "@/modules/admin/data/storage-breakdown";

/**
 * พื้นที่ไฟล์ของบริษัทเดียว แยกตามระบบ + ไฟล์ใหญ่สุดของแต่ละหมวด พร้อมลิงก์ไปที่ต้นทาง
 * (SUPER_ADMIN เท่านั้น เหมือนหน้า /admin/storage) — อ่านอย่างเดียว เคลียร์ที่ต้นทาง
 * ดูวิธีนับใน modules/admin/data/storage-breakdown.ts
 */
export const dynamic = "force-dynamic";

/** สีประจำระบบ — แถบรวมด้านบนกับจุดหน้าแต่ละแถวใช้สีเดียวกัน */
const SYSTEM_COLOR: Record<string, string> = {
  "รีพอร์ต & งาน": "#2E7D32",
  "แชท": "#2563EB",
  "ไฟล์บริษัท": "#7C3AED",
  "ซ่อมบำรุง": "#D97706",
  "บัญชีผู้ใช้": "#0891B2",
  "อื่น ๆ": "#6B7280",
};

function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }) : "-";
}

export default async function OrgStoragePage({ params }: { params: Promise<{ orgId: string }> }) {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");
  const { orgId } = await params;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, code: true } });
  if (!org) notFound();

  const { totalBytes, totalCount, categories } = await getStorageBreakdown(org.id);

  // รวมต่อระบบ (แถบสีด้านบน)
  const bySystem = new Map<string, number>();
  for (const c of categories) bySystem.set(c.system, (bySystem.get(c.system) ?? 0) + c.bytes);
  const systems = [...bySystem.entries()].sort((a, b) => b[1] - a[1]);
  const pct = (b: number) => (totalBytes > 0 ? (b / totalBytes) * 100 : 0);

  return (
    <AppScaffold title={`พื้นที่ไฟล์ · ${org.name}`} width="max-w-none" backHref="/admin/storage">
      <p className="mb-4 text-sm text-(--ink-soft)">
        นับจากไฟล์ที่เก็บอยู่จริงทุกระบบ (รวมรูปในรีพอร์ต/ใบงาน/PO ที่หน้ารวมยังไม่นับ) · หน้านี้ดูอย่างเดียว
        จะเคลียร์พื้นที่ให้กดลิงก์ไปลบที่ต้นทาง รูปในโพสต์/ใบงานจะได้ไม่หายไปเฉย ๆ
      </p>

      {categories.length === 0 ? (
        <EmptyState>บริษัทนี้ยังไม่มีไฟล์</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-(--ink)">ใช้รวม {fmtSize(totalBytes)}</p>
              <p className="text-xs text-(--ink-soft) tabular-nums">{totalCount.toLocaleString("th-TH")} ไฟล์</p>
            </div>
            <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-(--bg-soft)" role="img" aria-label="สัดส่วนพื้นที่ตามระบบ">
              {systems.map(([sys, b]) => (
                <div key={sys} style={{ width: `${pct(b)}%`, backgroundColor: SYSTEM_COLOR[sys] ?? "#6B7280" }} title={`${sys} ${fmtSize(b)}`} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {systems.map(([sys, b]) => (
                <span key={sys} className="inline-flex items-center gap-1.5 text-(--ink-soft)">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SYSTEM_COLOR[sys] ?? "#6B7280" }} />
                  <b className="font-semibold text-(--ink)">{sys}</b> {fmtSize(b)} · {pct(b).toFixed(0)}%
                </span>
              ))}
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <Card key={c.id} className="p-0">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-4">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SYSTEM_COLOR[c.system] ?? "#6B7280" }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-(--ink)">
                        {c.label} <span className="font-normal text-(--ink-soft)">· {c.system}</span>
                      </p>
                      <p className="text-xs text-(--ink-soft)">
                        {c.count.toLocaleString("th-TH")} ไฟล์
                        {c.orphanCount ? ` · ไม่พบที่ใช้ ${c.orphanCount.toLocaleString("th-TH")} ไฟล์ (${fmtSize(c.orphanBytes ?? 0)})` : ""}
                      </p>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-(--ink)">{fmtSize(c.bytes)}</span>
                    <span className="w-12 text-right text-xs tabular-nums text-(--ink-soft)">{pct(c.bytes).toFixed(1)}%</span>
                  </summary>
                  <div className="border-t border-(--line) px-4 pb-4 pt-3">
                    <p className="mb-2 text-xs text-(--ink-soft)">
                      เคลียร์ได้โดย: <b className="font-semibold text-(--ink)">{c.howToClear}</b> · ไฟล์ใหญ่สุด {c.largest.length} อันดับ
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-(--ink-soft)">
                            <th className="py-1.5 pr-3 font-medium">อยู่ที่</th>
                            <th className="py-1.5 pr-3 text-right font-medium">ขนาด</th>
                            <th className="py-1.5 text-right font-medium">อัปโหลด</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.largest.map((f) => (
                            <tr key={f.key} className="border-t border-(--line) align-top">
                              <td className="py-2 pr-3">
                                {f.source ? (
                                  f.source.href ? (
                                    <Link href={f.source.href} className="inline-flex items-start gap-1 text-(--brand-green-dark,#15803d) hover:underline">
                                      <span>{f.source.label}</span>
                                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    </Link>
                                  ) : (
                                    <span className="text-(--ink)">{f.source.label}</span>
                                  )
                                ) : (
                                  <span className="text-(--ink-soft)">ไม่พบที่ใช้</span>
                                )}
                                <a href={`/api/files/${f.key}`} target="_blank" rel="noreferrer" className="block text-[11px] text-(--ink-soft) hover:underline">
                                  เปิดดูไฟล์
                                </a>
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{fmtSize(f.size)}</td>
                              <td className="py-2 text-right text-xs tabular-nums whitespace-nowrap text-(--ink-soft)">{fmtDate(f.lastModified)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              </Card>
            ))}
          </div>
          <p className="text-xs text-(--ink-soft)">
            &quot;ไม่พบที่ใช้&quot; = ไฟล์ที่ไม่มีโพสต์/ใบงาน/ไฟล์บริษัทไหนอ้างถึงแล้ว (เช่น อัปโหลดแล้วยกเลิกก่อนส่ง) ·
            หมวดแชทไม่ได้ตรวจ เพราะแชทมีระยะเก็บและลบของมันเอง
          </p>
        </div>
      )}
    </AppScaffold>
  );
}
