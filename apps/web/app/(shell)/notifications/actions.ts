"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@smartboss/auth";
import { markAllRead } from "@/modules/maintenance/data/notify";

export async function markAllReadAction() {
  const session = await requireAuth();
  await markAllRead(session.userId);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
