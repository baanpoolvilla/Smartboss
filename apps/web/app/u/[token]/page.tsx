import { Home as HomeIcon, Camera, CheckCircle2, LinkIcon } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import {
  getUploadContext,
  listExternalPhotos,
} from "@/modules/maintenance/data/external-upload";
import { ExternalUploadForm } from "@/modules/maintenance/components/external-upload-form";
import { uploadExternalAction } from "./actions";

/** จำนวนรูปสูงสุดต่อ 1 ลิงก์ — ค่าเดียวกับ ChangYai */
const MAX_UPLOADS = 20;

/** หน้าส่งรูปสำหรับช่างภายนอก (ไม่ต้อง login) — port จาก external_work_order_upload_screen.dart */
export default async function ExternalUploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await getUploadContext(token);

  if (!ctx) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-(--bg-soft) p-6">
        <Card className="max-w-md p-8 text-center">
          <LinkIcon className="mx-auto mb-4 h-16 w-16 text-(--ink-soft) opacity-40" />
          <p className="text-base font-medium text-(--ink)">
            ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว
          </p>
          <p className="mt-1 text-xs text-(--ink-soft)">
            กรุณาขอลิงก์ใหม่จากผู้ดูแล
          </p>
        </Card>
      </div>
    );
  }

  const rows = await listExternalPhotos(ctx.orgId, ctx.workOrderId);
  // แถวที่ storagePath ว่างคือข้อความเปล่า ๆ ไม่นับเป็นรูป ไม่งั้นโควตาจะหมดเพราะการพิมพ์
  const photos = rows.filter((r) => r.storagePath !== "");
  const notes = rows.filter((r) => r.note);
  const remaining = Math.max(0, MAX_UPLOADS - photos.length);

  return (
    <div className="min-h-dvh bg-(--bg-soft) p-5">
      <div className="mx-auto max-w-[560px]">
        <h1 className="mb-4 text-center text-base font-semibold text-(--ink)">
          ส่งรูปงาน
        </h1>

        <Camera className="mx-auto h-14 w-14" style={{ color: "#0D9488" }} />
        <h2 className="mt-3 text-center text-xl font-bold text-(--ink)">
          ส่งรูปให้ผู้ดูแลใบงาน
        </h2>
        <p className="mt-2 text-center text-sm text-(--ink-soft)">
          หน้านี้ใช้ส่งรูปเท่านั้น คุณไม่สามารถเปลี่ยนสถานะหรือแก้ไขใบงานได้
        </p>

        <Card className="mt-5 p-4">
          <p className="text-base font-medium text-(--ink)">{ctx.title}</p>
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-(--ink)">
            <HomeIcon className="h-4 w-4" /> {ctx.propertyName ?? "-"}
          </p>
          <p className="mt-2 text-sm text-(--ink-soft)">
            ส่งแล้ว {photos.length}/{MAX_UPLOADS} รูป
          </p>
        </Card>

        {remaining === 0 ? (
          <Card className="mt-4 p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-[#16A34A]" />
            <p className="mt-2 text-sm text-(--ink)">
              ส่งรูปครบจำนวนที่กำหนดแล้ว
            </p>
          </Card>
        ) : (
          <Card className="mt-4 p-5">
            <ExternalUploadForm
              action={uploadExternalAction.bind(null, token)}
              remaining={remaining}
            />
          </Card>
        )}

        {/* สิ่งที่ส่งไปแล้ว — ให้ช่างเห็นว่าถึงปลายทางจริง จะได้ไม่ส่งซ้ำ */}
        {notes.length > 0 && (
          <Card className="mt-4 p-4">
            <p className="mb-2 text-sm font-medium text-(--ink)">ข้อความที่ส่งไปแล้ว</p>
            <ul className="flex flex-col gap-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-(--radius) bg-(--bg-soft) p-2.5 text-sm whitespace-pre-wrap text-(--ink)"
                >
                  {n.note}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="mt-4 text-center text-xs text-(--ink-soft)">© Smartboss</p>
      </div>
    </div>
  );
}
