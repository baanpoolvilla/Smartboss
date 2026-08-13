"use server";

import { revalidatePath } from "next/cache";
import { putFiles } from "@/modules/maintenance/lib/storage";
import {
  registerExternalPhoto,
  registerExternalNote,
  getUploadContext,
} from "@/modules/maintenance/data/external-upload";

export async function uploadExternalAction(token: string, formData: FormData) {
  const ctx = await getUploadContext(token);
  if (!ctx) return;

  const note = String(formData.get("note") ?? "");
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const urls = await putFiles(`maintenance/external/${token}`, files);

  if (urls.length === 0) {
    // ไม่มีรูปแต่มีข้อความ — ช่างที่เข้าไม่ได้/รออะไหล่ ไม่มีรูปจะส่งแต่ต้องบอกได้
    await registerExternalNote(token, note);
  } else {
    // ข้อความติดไปกับรูปแรกเท่านั้น ไม่งั้นจะซ้ำทุกรูปเวลาผู้ดูแลอ่าน
    for (const [i, url] of urls.entries()) {
      await registerExternalPhoto(token, url, i === 0 ? note : null);
    }
  }

  revalidatePath(`/u/${token}`);
}
