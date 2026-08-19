import Link from "next/link";
import { AlertTriangle, PlugZap } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { statusLabel, statusTone } from "../lib/labels";

export const inputClass =
  "flex h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/30";

export const selectClass = inputClass;

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-(--ink)">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-(--ink-soft)">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}

/** ป้ายสถานะ — สีมาจาก CSS variable ตาม spec ข้อ 11 (ห้าม hardcode hex) */
export function StatusBadge({ value }: { value: string | null | undefined }) {
  const tone = statusTone(value);
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)` }}
    >
      {statusLabel(value)}
    </span>
  );
}

/** ป้ายทั่วไปที่กำหนดสีเอง (ส่งเป็น CSS variable) */
export function Pill({
  tone = "var(--tone-muted)",
  children,
}: {
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "var(--ink)",
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: string;
}) {
  const body = (
    <Card className="p-4 transition-colors hover:bg-(--bg-soft)">
      <p className="text-xs text-(--ink-soft)">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: tone }}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-(--ink-soft)">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function SectionCard({
  title,
  description,
  action,
  className = "",
  children,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-(--ink)">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-(--ink-soft)">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card className="p-10 text-center text-sm text-(--ink-soft)">
      {children}
    </Card>
  );
}

/**
 * แสดงเมื่อเชื่อมต่อ workforce API ไม่ได้
 * บอกวิธีแก้ตรง ๆ ดีกว่าปล่อยหน้าเปล่าให้เดาเอง
 */
export function ApiUnavailable({ base }: { base: string }) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--danger-bg)">
          <PlugZap className="h-5 w-5 text-(--danger)" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-(--ink)">
            เชื่อมต่อระบบบุคคลไม่ได้
          </h2>
          <p className="mt-1 text-sm text-(--ink-soft)">
            หน้าจอนี้ดึงข้อมูลจาก workforce API ซึ่งรันเป็นโปรเซสแยก
            ตอนนี้เรียกไม่สำเร็จที่{" "}
            <code className="rounded bg-(--bg-soft) px-1 py-0.5 font-mono text-xs">
              {base}
            </code>
          </p>
          <div className="mt-3 rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">
            <p className="mb-1 font-medium text-(--ink)">วิธีเริ่มใช้งาน</p>
            <ol className="ml-4 list-decimal space-y-0.5">
              <li>ตั้ง env ของ workforce (ดู docs/workforce_integration.md)</li>
              <li>
                <code className="font-mono">pnpm wf:migrate</code> แล้ว{" "}
                <code className="font-mono">pnpm wf:sync</code>
              </li>
              <li>สตาร์ต API แล้วตั้ง <code className="font-mono">WORKFORCE_API_BASE</code></li>
            </ol>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * ไม่มีสิทธิ์ดูส่วนนี้ — ไม่ใช่ error ของระบบ
 * แสดง permission ที่ขาดด้วย เพื่อให้ผู้ดูแลรู้ว่าต้องเปิดสิทธิ์ตัวไหนที่ /admin/roles
 */
export function NoPermission({
  what,
  required,
}: {
  what: string;
  required?: string[];
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-(--tone-warn)" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-(--ink)">
            คุณไม่มีสิทธิ์ดู{what}
          </p>
          <p className="mt-1 text-sm text-(--ink-soft)">
            สิทธิ์ของระบบบุคคลมาจากบทบาทที่กำหนดใน{" "}
            <Link href="/admin/roles" className="text-(--app-strong) hover:underline">
              หลังบ้าน → บทบาท &amp; สิทธิ์
            </Link>{" "}
            แล้ว sync เข้า workforce
          </p>
          {required && required.length > 0 && (
            <p className="mt-2 font-mono text-xs text-(--ink-soft)">
              ต้องมี: {required.join(", ")}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** API ตอบกลับมาแบบไม่ใช่ 2xx ด้วยเหตุผลอื่น */
export function ApiProblem({
  heading,
  detail,
}: {
  heading: string;
  detail?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-(--tone-warn)" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-(--ink)">{heading}</p>
          {detail && (
            <p className="mt-1 whitespace-pre-line text-sm text-(--ink-soft)">
              {detail}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * บริษัทนี้ยังไม่มีนิติบุคคลในระบบบุคคล = ถูกตั้งต้นไม่ครบ ไม่ใช่หน้าที่ผู้ใช้ต้องมาแก้
 *
 * ปกติระบบสร้างนิติบุคคลให้อัตโนมัติตอนเปิดบริษัท (lib/workforce-provisioning.ts)
 * เหลือแค่บริษัทที่เปิดไว้ก่อนมีโค้ดส่วนนั้น ซึ่งกดปุ่มซ่อมครั้งเดียวจบ
 *
 * ทุกหน้าที่ต้องใช้ company_id ต้องขึ้นกล่องนี้ ไม่ใช่ซ่อนฟอร์มเงียบ ๆ —
 * การซ่อนทำให้ผู้ใช้เห็นหน้าเปล่าแล้วคิดว่าระบบพัง โดยไม่มีอะไรบอกว่าต้องทำอะไรต่อ
 */
export function NotProvisioned({ what }: { what?: string }) {
  return (
    <ApiProblem
      heading="ระบบบุคคลของบริษัทนี้ยังตั้งต้นไม่เสร็จ"
      detail={
        `ยังไม่มีนิติบุคคลผูกกับบริษัทนี้ จึงยัง${what ?? "ใช้งานส่วนนี้"}ไม่ได้\n` +
        "แจ้งผู้ดูแลระบบสูงสุดให้กด \u201cเปิดใช้โมดูลบุคคล\u201d ที่หน้าจัดการบริษัท (/admin/organizations) — กดครั้งเดียวจบ"
      }
    />
  );
}

/** ตารางที่เลื่อนแนวนอนได้บนจอแคบ */
export function DataTable({
  head,
  children,
}: {
  head: React.ReactNode[];
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-(--line) bg-(--bg-soft)">
              {head.map((cell, i) => (
                <th
                  key={i}
                  className="px-3 py-2.5 text-left text-xs font-semibold text-(--ink-soft)"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-(--line)">{children}</tbody>
        </table>
      </div>
    </Card>
  );
}

export function Td({
  children,
  className = "",
  align,
}: {
  children: React.ReactNode;
  className?: string;
  align?: "right" | "center";
}) {
  return (
    <td
      className={`px-3 py-2.5 text-(--ink) ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
