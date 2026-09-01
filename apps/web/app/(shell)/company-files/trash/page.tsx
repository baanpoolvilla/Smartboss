import { AppScaffold } from "@/components/module/app-scaffold";
import { listTrash } from "@/modules/company-files/data/files";
import { TrashList } from "@/modules/company-files/components/trash-list";

export const dynamic = "force-dynamic";

/** ถังขยะของโมดูลไฟล์บริษัท — ไฟล์/โฟลเดอร์ที่ถูกลบ (soft-delete) รวมไว้ที่เดียว
 * กู้คืนหรือลบถาวรได้ แบบ recycle bin ของ SharePoint */
export default async function CompanyFilesTrashPage() {
  const items = await listTrash();
  return (
    <AppScaffold title="ถังขยะ" width="max-w-3xl" backHref="/company-files">
      <p className="text-xs text-(--ink-soft) mb-3">
        ไฟล์และโฟลเดอร์ที่ลบจะมาพักที่นี่ก่อน — กู้คืนได้ หรือกดลบถาวรเพื่อล้างทิ้ง (กู้คืนไม่ได้อีก)
      </p>
      <TrashList items={items} />
    </AppScaffold>
  );
}
