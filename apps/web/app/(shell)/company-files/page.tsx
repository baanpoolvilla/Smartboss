import { AppScaffold } from "@/components/module/app-scaffold";
import { listFolder, getFolderPath, listRoomFolders, listAllFiles } from "@/modules/company-files/data/files";
import { FileBrowser } from "@/modules/company-files/components/file-browser";
import { AllFilesList } from "@/modules/company-files/components/all-files-list";

export const dynamic = "force-dynamic";

export default async function CompanyFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder } = await searchParams;
  const folderId = folder ?? null;
  // "ห้องรายงาน" กับลิสต์ไฟล์ทั้งหมดโชว์แค่ที่หน้าราก — เข้าไปในโฟลเดอร์ใดโฟลเดอร์
  // หนึ่งแล้วก็เป็นการเรียกดูแบบปกติ ไม่ต้อง fetch ซ้ำทุกชั้น
  const [{ folders, files }, path, roomFolders, allFiles] = await Promise.all([
    listFolder(folderId),
    getFolderPath(folderId),
    folderId === null ? listRoomFolders() : Promise.resolve([]),
    folderId === null ? listAllFiles() : Promise.resolve(null),
  ]);

  return (
    <AppScaffold title="ไฟล์บริษัท" width="max-w-5xl">
      <div className="flex flex-col gap-6">
        {allFiles && (
          <div>
            <p className="text-sm font-semibold mb-2">ไฟล์ทั้งหมด</p>
            <p className="text-xs text-(--ink-soft) mb-3">
              รวมไฟล์จากทุกที่ที่คุณเห็นได้ไว้ที่เดียว — ไฟล์ในห้องที่คุณไม่ได้อยู่จะไม่ปรากฏที่นี่
            </p>
            <AllFilesList files={allFiles} />
          </div>
        )}

        {folderId === null && (
          <div>
            <p className="text-sm font-semibold mb-2">เรียกดูตามโฟลเดอร์</p>
            <FileBrowser
              currentFolderId={folderId}
              path={path}
              folders={folders}
              files={files}
              roomFolders={roomFolders}
            />
          </div>
        )}
        {folderId !== null && (
          <FileBrowser currentFolderId={folderId} path={path} folders={folders} files={files} />
        )}
      </div>
    </AppScaffold>
  );
}
