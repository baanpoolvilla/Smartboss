import { notFound } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { AppScaffold } from "@/components/module/app-scaffold";
import { listFileVersions, listShareLinks } from "@/modules/company-files/data/files";
import { FileDetail } from "@/modules/company-files/components/file-detail";

export const dynamic = "force-dynamic";

export default async function CompanyFileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  const { id } = await params;

  const file = await prisma.companyFile.findFirst({ where: { id, orgId: session.orgId } });
  if (!file) notFound();

  const [versions, shareLinks] = await Promise.all([listFileVersions(id), listShareLinks(id)]);
  const uploaderIds = Array.from(new Set(versions.map((v) => v.uploadedBy)));
  const uploaders = uploaderIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true } }) : [];
  const uploaderNames = Object.fromEntries(uploaders.map((u) => [u.id, u.name]));

  return (
    <AppScaffold title={file.name} width="max-w-3xl" backHref={file.folderId ? `/company-files?folder=${file.folderId}` : "/company-files"}>
      <FileDetail file={file} versions={versions} shareLinks={shareLinks} uploaderNames={uploaderNames} />
    </AppScaffold>
  );
}
