import { notFound, redirect } from "next/navigation";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { PrintButton } from "@/modules/daily_worker/components/print-button";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { loadRequests, readSettings, withRequestsTenant } from "@/modules/requests/lib/db";
import { baht, thaiDate } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "หนังสือรับรองการหักภาษี ณ ที่จ่าย · Smartboss" };

/** "1234567890123" → "1 2345 67890 12 3" */
const taxIdText = (id: string) => {
  const d = id.replace(/\D/g, "");
  return d.length === 13 ? `${d[0]} ${d.slice(1, 5)} ${d.slice(5, 10)} ${d.slice(10, 12)} ${d[12]}` : id || "";
};

/** ประเภทเงินได้ตามอัตรา — มาตรา 3 เตรส (คำสั่ง ท.ป. 4/2528) */
const INCOME_BY_RATE: Record<string, string> = {
  "1": "ค่าขนส่ง",
  "2": "ค่าโฆษณา",
  "3": "ค่าบริการ / ค่าจ้างทำของ",
  "5": "ค่าเช่า",
};

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ของใบ "จ่ายช่าง / ร้านค้า" ที่จ่ายแล้ว (ผู้ใช้ 22/11/2569 — แนว PEAK
 * "จ่ายแล้วพิมพ์ใบหัก ณ ที่จ่ายจากหน้าข้อมูลการชำระ") · ภ.ง.ด.3 = บุคคล · ภ.ง.ด.53 = นิติบุคคล (จากทะเบียนช่าง/ร้าน)
 * ผู้จ่ายเงิน = ตั้งค่าเบิกจ่าย · เลขที่ = เลขใบ · สองฉบับ (ผู้ถูกหักภาษี / ผู้จ่ายเก็บไว้)
 * อยู่นอกกลุ่ม (shell) ให้พิมพ์ได้ไม่มีเมนูแอป
 */
export default async function WhtCertPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  if (!hasPermission(session, REQ_PERMS.pay) && !hasPermission(session, REQ_PERMS.viewAll)) redirect("/requests");
  const { id } = await params;
  const orgId = session.orgId;
  const [[r], settings] = await withRequestsTenant(orgId, (tx) => Promise.all([loadRequests(tx, orgId, { id }, 1), readSettings(tx, orgId)]));
  if (!r || r.kind !== "contractor" || r.whtAmount <= 0) notFound();
  const vendor = r.vendorId ? await withRequestsTenant(orgId, (tx) => tx.moneyVendor.findFirst({ where: { orgId, id: r.vendorId! } })) : null;
  const pays = r.payments.filter((p) => !p.voided);
  const paidOn = pays.length ? pays[pays.length - 1]!.paidOn : null;
  const form = vendor?.kind === "company" ? "ภ.ง.ด.53" : "ภ.ง.ด.3";
  const income = INCOME_BY_RATE[String(r.whtPercent)] ?? "ค่าบริการ / ค่าจ้างทำของ";
  const missing = [
    !settings.payerName && "ชื่อบริษัทผู้จ่ายเงิน",
    settings.payerTaxId.length !== 13 && "เลขผู้เสียภาษีบริษัท",
    !settings.payerAddress && "ที่อยู่บริษัท",
    !(vendor?.taxId ?? "").replace(/\D/g, "") && "เลขผู้เสียภาษีของผู้รับเงิน (ทะเบียนช่าง/ร้าน)",
    r.status !== "paid" && "ใบนี้ยังจ่ายไม่ครบ",
  ].filter(Boolean) as string[];

  const copy = (title: string) => (
    <section className="cert">
      <div className="top">
        <div><b>ฉบับที่ {title}</b></div>
        <div>เลขที่ {r.code}</div>
      </div>
      <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
      <p className="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
      <table className="party">
        <tbody>
          <tr>
            <th>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</th>
            <td>
              <div><b>{settings.payerName || "—"}</b></div>
              <div>เลขประจำตัวผู้เสียภาษีอากร {taxIdText(settings.payerTaxId) || "—"}</div>
              <div>ที่อยู่ {settings.payerAddress || "—"}</div>
            </td>
          </tr>
          <tr>
            <th>ผู้ถูกหักภาษี ณ ที่จ่าย</th>
            <td>
              <div><b>{vendor?.name ?? r.beneficiaryName}</b> ({vendor?.kind === "company" ? "นิติบุคคล" : "บุคคลธรรมดา"})</div>
              <div>เลขประจำตัวผู้เสียภาษีอากร {taxIdText(vendor?.taxId ?? "") || "—"}</div>
              <div>ที่อยู่ {vendor?.address || "—"}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="form">ยื่นแบบ: <b>{form}</b></div>
      <table className="items">
        <thead>
          <tr><th>ประเภทเงินได้ที่จ่าย</th><th>วันที่จ่าย</th><th className="n">จำนวนเงินที่จ่าย</th><th className="n">ภาษีที่หักและนำส่งไว้</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>5. ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส — {income} ({r.whtPercent}%)<div className="small">{r.title}</div></td>
            <td>{paidOn ? thaiDate(paidOn) : "—"}</td>
            <td className="n">{baht(r.amount, false)}</td>
            <td className="n">{baht(r.whtAmount, false)}</td>
          </tr>
          <tr className="sum">
            <td colSpan={2}>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td>
            <td className="n">{baht(r.amount, false)}</td>
            <td className="n">{baht(r.whtAmount, false)}</td>
          </tr>
        </tbody>
      </table>
      <div className="pay">ผู้จ่ายเงิน: ☑ (1) หัก ณ ที่จ่าย ☐ (2) ออกให้ตลอดไป ☐ (3) ออกให้ครั้งเดียว ☐ (4) อื่น ๆ</div>
      <div className="sign">
        <div>ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</div>
        <div className="line">ลงชื่อ ............................................................ ผู้จ่ายเงิน</div>
        <div>วันที่ {paidOn ? thaiDate(paidOn) : "...................."}</div>
      </div>
    </section>
  );

  return (
    <main className="wrap">
      <style>{`
        .wrap{max-width:820px;margin:0 auto;padding:24px 16px;font-family:"IBM Plex Sans Thai",system-ui,sans-serif;color:#111;background:#fff}
        .bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
        .warn{border:1px solid #f0c36d;background:#fff8e6;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:16px}
        .cert{border:1px solid #333;padding:18px 20px;margin-bottom:24px;font-size:13px;line-height:1.55;break-inside:avoid}
        .cert .top{display:flex;justify-content:space-between}
        .cert h1{font-size:18px;text-align:center;margin:6px 0 0}
        .cert .sub{text-align:center;margin:0 0 10px;font-size:12px}
        table{width:100%;border-collapse:collapse}
        .party th{width:30%;text-align:left;vertical-align:top;padding:6px;border:1px solid #999;background:#f3f3f3;font-weight:600}
        .party td{padding:6px;border:1px solid #999}
        .form{margin:10px 0 6px}
        .items th,.items td{border:1px solid #999;padding:6px;vertical-align:top}
        .items th{background:#f3f3f3;font-weight:600;text-align:left}
        .items .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
        .items .sum td{font-weight:700}
        .small{font-size:11px;color:#555}
        .pay{margin-top:10px}
        .sign{margin-top:16px;text-align:center}
        .sign .line{margin-top:26px}
        @media print{.bar,.warn{display:none}.wrap{padding:0}.cert{margin-bottom:0;page-break-after:always}}
      `}</style>
      <div className="bar">
        <div>
          <b>50 ทวิ · {r.code}</b> · {vendor?.name ?? r.beneficiaryName} · หัก {r.whtPercent}% {baht(r.whtAmount)}
        </div>
        <PrintButton />
      </div>
      {missing.length > 0 && <div className="warn">ข้อมูลยังไม่ครบ: {missing.join(" · ")} — แก้ที่ ตั้งค่าเบิกจ่าย (ผู้จ่ายเงิน) / ทะเบียนช่าง-ร้าน แล้วเปิดหน้านี้ใหม่</div>}
      {copy("1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)")}
      {copy("2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)")}
    </main>
  );
}
