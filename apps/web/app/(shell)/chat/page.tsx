import { redirect } from "next/navigation";

// แชทย้ายไปอยู่ใต้ "รายงานและงาน" แล้ว — คงทางเก่าไว้ให้ลิงก์/บุ๊กมาร์กเดิมยังใช้ได้ (รวม ?c=<ห้อง>)
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  redirect(c ? `/report-task/chat?c=${encodeURIComponent(c)}` : "/report-task/chat");
}
