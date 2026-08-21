/**
 * UI primitives ของโมดูล maintenance — แปลงตรงจากวิดเจ็ตที่ ChangYai ใช้ซ้ำทุกหน้า
 * (Card + _infoRow + badge + FilterChip) ให้หน้าตาเหมือนเดิมทุกจอ
 */
import Link from "next/link";
import { Card } from "@smartboss/ui/components/card";

export const selectClass =
  "flex h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export const textareaClass =
  "w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export const fileInputClass =
  "text-sm text-(--ink) file:mr-3 file:rounded-(--radius) file:border file:border-(--line) file:bg-(--bg-soft) file:px-3 file:py-1.5 file:text-sm";

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

/**
 * ช่องกรอกที่มีตัวเลือกให้เลือก แต่พิมพ์ค่าใหม่ได้ด้วย (input + datalist)
 *
 * ใช้แทน select กับค่าที่ไม่ใช่ค่าคงที่ของระบบ เช่น หมวดหมู่/โซนของ Contact —
 * แต่ละบริษัทแบ่งไม่เหมือนกัน ตัวเลือกที่เห็นคือค่าที่บริษัทนั้นเคยใช้จริง
 * พิมพ์ค่าใหม่เข้าไปก็จะกลายเป็นตัวเลือกให้คนถัดไปเอง
 *
 * ⚠ listId ต้องไม่ซ้ำกันในหน้าเดียว — datalist ผูกกันด้วย id ถ้าซ้ำ ช่องหลังจะ
 * ได้ตัวเลือกของช่องแรกไปแสดง โดยไม่มี error อะไรให้เห็น
 */
export function ComboInput({
  name,
  listId,
  options,
  placeholder,
  defaultValue,
  required,
}: {
  name: string;
  listId: string;
  options: string[];
  placeholder: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <>
      <input
        name={name}
        list={listId}
        required={required}
        maxLength={100}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={selectClass}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

/** แถวข้อมูล ไอคอน + label กว้างคงที่ + ค่า (ตรงกับ _infoRow เดิม) */
export function InfoRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5 text-sm">
      {icon && <span className="mt-0.5 text-(--ink-soft)">{icon}</span>}
      <span className="w-[110px] shrink-0 text-(--ink-soft)">{label}</span>
      <span
        className="min-w-0 flex-1 font-medium text-(--ink)"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/** ป้ายสีอ่อน (ใช้แทน Container + withValues(alpha:.1) ของเดิม) */
export function Badge({
  color,
  children,
  className = "",
}: {
  color: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] ${className}`}
      style={{
        color,
        backgroundColor: `${color}1a`,
        border: `1px solid ${color}4d`,
      }}
    >
      {children}
    </span>
  );
}

/** การ์ดหัวข้อ (Card + Row(icon, titleMedium)) */
export function SectionCard({
  title,
  icon,
  titleColor,
  action,
  className = "",
  children,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  titleColor?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`p-4 sm:p-5 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon}
          <h2
            className="text-sm font-semibold text-(--ink)"
            style={titleColor ? { color: titleColor } : undefined}
          >
            {title}
          </h2>
          {action && <div className="ml-auto">{action}</div>}
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

/** ชิปกรอง (FilterChip) แบบลิงก์ — ใช้บนหน้าที่กรองผ่าน query string */
export function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <span
        className="inline-block whitespace-nowrap rounded-full border px-3 py-1 text-xs"
        style={
          active
            ? { color: "#0F766E", borderColor: "#0D9488", backgroundColor: "#CCFBF1" }
            : { color: "var(--ink-soft)", borderColor: "var(--line)" }
        }
      >
        {children}
      </span>
    </Link>
  );
}

/** ลิงก์ย้อนกลับหัวหน้าจอ */
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="mb-4 inline-flex items-center gap-1 text-sm text-(--ink-soft) hover:text-(--ink)"
    >
      <span aria-hidden>←</span> {children}
    </Link>
  );
}
