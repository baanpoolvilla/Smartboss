import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { EXAMPLE_PERMISSIONS } from "@/modules/example/manifest";
import { listExampleItems } from "@/modules/example/data";
import { createItemAction, deleteItemAction, toggleItemAction } from "./actions";

export default async function ExamplePage() {
  const session = await requireOrg();
  if (!hasPermission(session, EXAMPLE_PERMISSIONS.view)) redirect("/");

  const canManage = hasPermission(session, EXAMPLE_PERMISSIONS.manage);
  const items = await listExampleItems(session.orgId);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-(--ink)">
          รายการตัวอย่าง
        </h1>
        <p className="mt-1 text-sm text-(--ink-soft)">
          โมดูลตัวอย่าง (แม่แบบ) — ข้อมูลทั้งหมดเป็นของบริษัทคุณเท่านั้น
        </p>
      </header>

      {canManage && (
        <Card className="mb-6 p-5">
          <form action={createItemAction} className="flex flex-col gap-3 sm:flex-row">
            <Input name="title" placeholder="ชื่อรายการ" required className="flex-1" />
            <Input name="note" placeholder="รายละเอียด (ไม่บังคับ)" className="flex-1" />
            <Button type="submit" className="sm:w-32">
              เพิ่มรายการ
            </Button>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีรายการ {canManage ? "— เพิ่มรายการแรกด้านบนได้เลย" : ""}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <Card key={item.id} className="flex items-center gap-3 p-4">
              <span
                className="rounded-full px-2.5 py-1 text-xs font-medium"
                style={{
                  backgroundColor:
                    item.status === "done"
                      ? "var(--mod-report-bg, #EEF2F7)"
                      : "var(--module-color-bg)",
                  color:
                    item.status === "done"
                      ? "var(--ink-soft)"
                      : "var(--brand-green)",
                }}
              >
                {item.status === "done" ? "เสร็จแล้ว" : "กำลังทำ"}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={
                    "truncate text-sm font-medium text-(--ink) " +
                    (item.status === "done" ? "line-through opacity-60" : "")
                  }
                >
                  {item.title}
                </p>
                {item.note && (
                  <p className="truncate text-xs text-(--ink-soft)">
                    {item.note}
                  </p>
                )}
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <form action={toggleItemAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {item.status === "done" ? "ทำต่อ" : "เสร็จ"}
                    </Button>
                  </form>
                  <form action={deleteItemAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      ลบ
                    </Button>
                  </form>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
