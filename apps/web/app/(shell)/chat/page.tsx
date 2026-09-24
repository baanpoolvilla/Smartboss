import { redirect } from "next/navigation";

// แชทย้ายไปอยู่ใต้ "รายงานและงาน" แล้ว — คงทางเก่าไว้ให้ลิงก์/บุ๊กมาร์กเดิมยังใช้ได้
export default function ChatPage() {
  redirect("/report-task/chat");
}
