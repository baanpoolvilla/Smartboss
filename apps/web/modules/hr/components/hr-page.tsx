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
    /*
     * 401 จาก workforce มีสองความหมายที่ต่างกันมากสำหรับผู้ใช้
     *
     *   token หมดอายุ/ไม่ถูกต้อง → เข้าสู่ระบบใหม่แล้วจบ
     *   บัญชียังไม่ถูก provision → เข้าใหม่กี่ครั้งก็ไม่หาย ต้องให้แอดมิน sync ให้
     *
     * เดิมขึ้น "เซสชันหมดอายุ" ทั้งสองกรณี คนที่เจอแบบหลังจึงวนล็อกอินซ้ำไปเรื่อย ๆ
     * โดยไม่มีทางรู้ว่าปัญหาอยู่ที่ไหน — แยกข้อความตาม detail ที่ API ส่งมา
     */
    const detail = error.problem.detail ?? "";
    if (detail.includes("not provisioned")) {
      return (
        <ApiProblem
          heading="บัญชีนี้ยังไม่ถูกเปิดใช้ในระบบบุคคล"
          detail={
            "บัญชีของคุณยังไม่ถูกผูกกับระบบบุคคลของบริษัท เข้าสู่ระบบใหม่ก็ยังเข้าไม่ได้\n" +
            "แจ้งผู้ดูแลระบบให้เปิดสิทธิ์ให้ที่หน้าจัดการผู้ใช้ (/admin/users)"
          }
        />
      );
    }
    return (
      <ApiProblem
        heading="เซสชันหมดอายุ"
        detail="กรุณาเข้าสู่ระบบใหม่อีกครั้ง"
      />
    );
  }

  if (error.status === 503 || error.status === 502) {
    return (
      <ApiProblem
        heading="ระบบบุคคลไม่พร้อมใช้งานชั่วคราว"
        detail="ลองใหม่อีกครั้งในอีกสักครู่ — ถ้ายังไม่หาย แจ้งผู้ดูแลระบบ"
      />
    );
  }

  return (
    <ApiProblem heading={error.problem.title} detail={error.displayMessage} />
  );
}
