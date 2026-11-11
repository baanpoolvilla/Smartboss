import { redirect } from "next/navigation";
import { getSession } from "@smartboss/auth";
import { Logo } from "@/components/logo";
import { ModuleStrip } from "@/components/module-strip";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; idle?: string; changed?: string }>;
}) {
  // login แล้วไม่ต้องเข้าหน้านี้ซ้ำ
  const session = await getSession();
  if (session) redirect("/");

  const { next, idle, changed } = await searchParams;
  // บอกให้ชัดว่าทำไมถึงมาอยู่หน้านี้ — ไม่งั้นคนจะนึกว่าระบบหลุดเอง
  const idleMinutes = Number(idle);
  const notice = changed
    ? "เปลี่ยนรหัสผ่านแล้ว และออกจากระบบทุกเครื่องแล้ว — เข้าใหม่ด้วยรหัสผ่านใหม่"
    : idle
      ? `ออกจากระบบให้แล้ว เพราะไม่มีการใช้งาน${Number.isFinite(idleMinutes) && idleMinutes > 0 ? `เกิน ${idleMinutes} นาที` : "ตามเวลาที่บริษัทตั้งไว้"} — เข้าใหม่ได้เลย`
      : undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-(--bg) px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-7 shadow-(--shadow-card) sm:p-8">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <Logo size="lg" />
            <h1 className="mt-2 text-lg font-semibold text-(--ink)">
              เข้าสู่ระบบ
            </h1>
          </div>

          <LoginForm next={next} notice={notice} />

          <p className="mt-6 text-center text-xs text-(--ink-soft)">
            ติดต่อผู้ดูแลระบบเพื่อขอบัญชี
          </p>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          <ModuleStrip />
          <p className="text-xs text-(--ink-soft)">© Smartboss</p>
        </div>
      </div>
    </main>
  );
}
