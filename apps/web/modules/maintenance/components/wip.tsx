import { Card } from "@smartboss/ui/components/card";

/** Placeholder ระหว่างที่ยัง port ฟีเจอร์ในเฟสถัดไป */
export function Wip({
  title,
  description,
  phase,
}: {
  title: string;
  description?: string;
  phase: string;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-(--ink)">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-(--ink-soft)">{description}</p>
        )}
      </header>
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-(--ink)">
          อยู่ระหว่างพัฒนา ({phase})
        </p>
        <p className="mt-1 text-xs text-(--ink-soft)">
          กำลัง port ฟีเจอร์นี้จากระบบเดิม (ChangYai) ให้เข้ากับ Smartboss
        </p>
      </Card>
    </div>
  );
}
