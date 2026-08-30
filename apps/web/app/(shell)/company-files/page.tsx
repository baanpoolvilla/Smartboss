import { AppScaffold } from "@/components/module/app-scaffold";
import { listFolder, getFolderPath } from "@/modules/company-files/data/files";
import { FileBrowser } from "@/modules/company-files/components/file-browser";

export const dynamic = "force-dynamic";

export default async function CompanyFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder } = await searchParams;
  const folderId = folder ?? null;
  const [{ folders, files }, path] = await Promise.all([listFolder(folderId), getFolderPath(folderId)]);

  return (
    <AppScaffold title="ไฟล์บริษัท" width="max-w-5xl">
      <FileBrowser currentFolderId={folderId} path={path} folders={folders} files={files} />
    </AppScaffold>
  );
}
