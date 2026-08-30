import { AppScaffold } from "@/components/module/app-scaffold";
import { listFolder, getFolderPath, listRoomFolders } from "@/modules/company-files/data/files";
import { FileBrowser } from "@/modules/company-files/components/file-browser";

export const dynamic = "force-dynamic";

export default async function CompanyFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder } = await searchParams;
  const folderId = folder ?? null;
  // "ห้องรายงาน" (โฟลเดอร์ที่ผูกกับห้องของโมดูลรายงาน) โชว์แค่ที่หน้าราก — เข้าไป
  // ข้างในแล้วก็เป็นโฟลเดอร์ปกติเหมือนที่อื่น ไม่ต้อง fetch ซ้ำทุกชั้น
  const [{ folders, files }, path, roomFolders] = await Promise.all([
    listFolder(folderId),
    getFolderPath(folderId),
    folderId === null ? listRoomFolders() : Promise.resolve([]),
  ]);

  return (
    <AppScaffold title="ไฟล์บริษัท" width="max-w-5xl">
      <FileBrowser
        currentFolderId={folderId}
        path={path}
        folders={folders}
        files={files}
        roomFolders={roomFolders}
      />
    </AppScaffold>
  );
}
