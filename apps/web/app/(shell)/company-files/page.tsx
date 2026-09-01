import { AppScaffold } from "@/components/module/app-scaffold";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { listFolder, getFolderPath, listRoomFolders, listAllFiles, searchFiles } from "@/modules/company-files/data/files";
import { FileBrowser } from "@/modules/company-files/components/file-browser";
import { AllFilesList } from "@/modules/company-files/components/all-files-list";

export const dynamic = "force-dynamic";

export default async function CompanyFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; q?: string }>;
}) {
  const { folder, q } = await searchParams;
  const query = (q ?? "").trim();
  const folderId = folder ?? null;
  // "ห้องรายงาน" กับลิสต์ไฟล์ทั้งหมดโชว์แค่ที่หน้าราก — เข้าไปในโฟลเดอร์ใดโฟลเดอร์
  // หนึ่งแล้วก็เป็นการเรียกดูแบบปกติ ไม่ต้อง fetch ซ้ำทุกชั้น
  const [{ folders, files }, path, roomFolders, allFiles] = await Promise.all([
    listFolder(folderId),
    getFolderPath(folderId),
    folderId === null ? listRoomFolders() : Promise.resolve([]),
    folderId === null ? listAllFiles() : Promise.resolve(null),
  ]);

  // ชื่อคนอัปโหลด/แก้ล่าสุดของไฟล์ในโฟลเดอร์นี้ — ส่งให้ FileBrowser โชว์คอลัมน์ "แก้โดย"
  // (query ผูก orgId ให้ครบตาม tenant-guard)
  const session = await requireOrg();
  const nameIds = Array.from(
    new Set(files.flatMap((f) => [f.createdBy, f.updatedBy].filter((x): x is string => !!x)))
  );
  const nameRows = nameIds.length
    ? await prisma.user.findMany({ where: { id: { in: nameIds }, orgId: session.orgId }, select: { id: true, name: true } })
    : [];
  const uploaderNames = Object.fromEntries(nameRows.map((u) => [u.id, u.name]));

  const searchResults = query ? await searchFiles(query) : null;

  return (
    <AppScaffold title="ไฟล์บริษัท" width="max-w-5xl">
      <div className="flex flex-col gap-6">
        <form action="/company-files" method="get" className="flex items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ค้นหาไฟล์ตามชื่อ..."
            className="h-10 flex-1 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm"
          />
          <button type="submit" className="h-10 rounded-(--radius) bg-(--brand-green,#16a34a) px-4 text-sm font-medium text-white">
            ค้นหา
          </button>
        </form>

        {searchResults !== null && (
          <div>
            <p className="text-sm font-semibold mb-2">
              ผลการค้นหา “{query}” ({searchResults.length}{searchResults.length >= 100 ? "+" : ""})
            </p>
            <AllFilesList files={searchResults} />
          </div>
        )}
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
              uploaderNames={uploaderNames}
            />
          </div>
        )}
        {folderId !== null && (
          <FileBrowser currentFolderId={folderId} path={path} folders={folders} files={files} uploaderNames={uploaderNames} />
        )}
      </div>
    </AppScaffold>
  );
}
