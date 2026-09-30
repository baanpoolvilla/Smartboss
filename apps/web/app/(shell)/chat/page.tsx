import { redirect } from "next/navigation";

import { CHAT_PAGE_PATH } from "@/modules/chat/constants";

// แชทอยู่ในโมดูล "Chat & Report" — คงทางเก่าไว้ให้ลิงก์/บุ๊กมาร์กเดิมยังใช้ได้ (รวม ?c=<ห้อง>)
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  redirect(c ? `${CHAT_PAGE_PATH}?c=${encodeURIComponent(c)}` : CHAT_PAGE_PATH);
}
