import { redirect } from "next/navigation";

/** ย้ายไป /clock (นอกระบบบุคคล ให้ได้แถบล่างของหน้าแรก) — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้ */
export default function OldClockPage() {
  redirect("/clock");
}
