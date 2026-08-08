import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { AppScaffold } from "@/components/module/app-scaffold";
import {
  WORKFORCE_API_BASE,
  WorkforceError,
  WorkforceUnavailableError,
} from "../lib/api";
import { ApiUnavailable, ApiProblem, NoPermission } from "./ui";

/**
 * โครงหน้าจอของโมดูลบุคคล
 *
 * รวมสามอย่างที่ทุกหน้าต้องทำเหมือนกันไว้ที่เดียว:
 *   1. ตรวจสิทธิ์ของ Smartboss ก่อนถึงจะยิงไป workforce
 *   2. แปลงคำตอบที่ไม่ใช่ 2xx ของ API เป็นข้อความที่อ่านรู้เรื่อง แทนที่จะพังทั้งหน้า
 *   3. AppScaffold (rail + AppBar) แบบเดียวกับโมดูลอื่น
 *
 * หมายเหตุ: สิทธิ์ของ Smartboss กับของ workforce ไม่ใช่ชุดเดียวกัน
 * ผู้ใช้อาจผ่านด่านแรกแต่ workforce ยังปฏิเสธ (เช่น TENANT_ADMIN ไม่ได้สิทธิ์ payroll
 * เพราะกฎแยกหน้าที่) — กรณีนั้นต้องขึ้นว่า "ไม่มีสิทธิ์" ไม่ใช่ 500
 */
export async function HrPage({
  title,
  permission,
  backHref,
  actions,
  fab,
  width,
  load,
}: {
  title: string;
  /** permission ของ Smartboss ที่ต้องมีถึงจะเข้าหน้านี้ได้ */
  permission: string;
  backHref?: string;
  actions?: React.ReactNode;
  fab?: React.ReactNode;
  width?: string;
  load: () => Promise<React.ReactNode>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, permission)) redirect("/");

  let body: React.ReactNode;
  try {
    body = await load();
  } catch (error) {
    if (error instanceof WorkforceUnavailableError) {
      body = <ApiUnavailable base={WORKFORCE_API_BASE} />;
    } else if (error instanceof WorkforceError) {
      body = <ProblemBody error={error} title={title} />;
    } else {
      throw error;
    }
  }

  return (
    <AppScaffold
      title={title}
      width={width ?? "max-w-5xl"}
      backHref={backHref}
      actions={actions}
      fab={fab}
    >
      {body}
    </AppScaffold>
  );
}

function ProblemBody({ error, title }: { error: WorkforceError; title: string }) {
  if (error.status === 403) {
    const required = (error.problem as { meta?: { required_permissions?: string[] } })
      .meta?.required_permissions;
    return <NoPermission what={title} required={required} />;
  }

  if (error.status === 401) {
    return (
      <ApiProblem
        heading="เซสชันหมดอายุ"
        detail="กรุณาเข้าสู่ระบบใหม่อีกครั้ง"
      />
    );
  }

  return (
    <ApiProblem heading={error.problem.title} detail={error.displayMessage} />
  );
}
