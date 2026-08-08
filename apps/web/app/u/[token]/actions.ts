"use server";

import { revalidatePath } from "next/cache";
import { putFiles } from "@/modules/maintenance/lib/storage";
import { registerExternalPhoto, getUploadContext } from "@/modules/maintenance/data/external-upload";

export async function uploadExternalAction(token: string, formData: FormData) {
  const ctx = await getUploadContext(token);
  if (!ctx) return;
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const urls = await putFiles(`maintenance/external/${token}`, files);
  for (const url of urls) {
    await registerExternalPhoto(token, url);
  }
  revalidatePath(`/u/${token}`);
}
