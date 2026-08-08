import { Card } from "@smartboss/ui/components/card";
import { Input } from "@smartboss/ui/components/input";
import { Button } from "@smartboss/ui/components/button";

export const selectClass =
  "flex h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-(--ink)">{label}</span>
      {children}
    </label>
  );
}

export interface PropertyDefaults {
  name?: string;
  caretakerId?: string | null;
  address?: string | null;
  ownerName?: string | null;
  ownerContact?: string | null;
  notes?: string | null;
}

export function PropertyForm({
  action,
  caretakers,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  caretakers: { id: string; name: string }[];
  defaults?: PropertyDefaults;
  submitLabel: string;
}) {
  const d = defaults ?? {};
  return (
    <Card className="p-5">
      <form action={action} className="flex flex-col gap-4">
        <Field label="ชื่อบ้าน *">
          <Input name="name" defaultValue={d.name ?? ""} required maxLength={200} />
        </Field>

        <Field label="ผู้จัดการบ้าน">
          <select
            name="caretakerId"
            defaultValue={d.caretakerId ?? ""}
            className={selectClass}
          >
            <option value="">ไม่ระบุ</option>
            {caretakers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="ที่อยู่">
          <Input name="address" defaultValue={d.address ?? ""} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ชื่อเจ้าของ">
            <Input name="ownerName" defaultValue={d.ownerName ?? ""} />
          </Field>
          <Field label="ติดต่อเจ้าของ">
            <Input name="ownerContact" defaultValue={d.ownerContact ?? ""} />
          </Field>
        </div>

        <Field label="หมายเหตุ">
          <textarea
            name="notes"
            defaultValue={d.notes ?? ""}
            rows={3}
            className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30"
          />
        </Field>

        <div className="flex gap-2 pt-1">
          <Button type="submit" className="sm:w-40">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
