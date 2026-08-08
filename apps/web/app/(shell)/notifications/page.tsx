import Link from "next/link";
import {
  ClipboardList,
  CalendarClock,
  ReceiptText,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { requireAuth } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { listNotifications } from "@/modules/maintenance/data/notify";
import { markAllReadAction } from "./actions";

const TYPE_META: Record<string, { Icon: LucideIcon; color: string }> = {
  work_order: { Icon: ClipboardList, color: "#2196F3" },
  pm: { Icon: CalendarClock, color: "#FF9800" },
  expense: { Icon: ReceiptText, color: "#4CAF50" },
  purchase_order: { Icon: ReceiptText, color: "#4CAF50" },
};

/** "5 นาทีที่แล้ว" — ตรงกับ _timeAgo ของ ChangYai */
function timeAgo(dt: Date): string {
  const diffMs = Date.now() - dt.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} วันที่แล้ว`;
  return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
}

function hrefFor(type: string, referenceId: string | null): string | null {
  if (type === "work_order" && referenceId)
    return `/maintenance/work-orders/${referenceId}`;
  if (type === "purchase_order" && referenceId)
    return `/maintenance/purchase-orders/${referenceId}`;
  if (type === "pm") return "/maintenance/pm";
  if (type === "expense") return "/maintenance/expenses";
  return null;
}

export default async function NotificationsPage() {
  const session = await requireAuth();
  const items = await listNotifications(session.userId);
  const hasUnread = items.some((n) => n.readAt === null);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-(--ink)">การแจ้งเตือน</h1>
        {hasUnread && (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline" size="sm">
              อ่านทั้งหมดแล้ว
            </Button>
          </form>
        )}
      </header>

      {items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีการแจ้งเตือน
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => {
            const meta = TYPE_META[n.type] ?? { Icon: Bell, color: "#9E9E9E" };
            const unread = n.readAt === null;
            const href = hrefFor(n.type, n.referenceId);

            const card = (
              <Card
                className="flex items-start gap-3 p-4"
                style={unread ? { backgroundColor: "#2196F30a" } : undefined}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: unread ? `${meta.color}33` : "#E5E7EB",
                  }}
                >
                  <meta.Icon
                    className="h-5 w-5"
                    style={{ color: unread ? meta.color : "#9CA3AF" }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="line-clamp-2 text-sm text-(--ink)"
                    style={unread ? { fontWeight: 700 } : undefined}
                  >
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-(--ink-soft)">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-(--ink-soft)">
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
                {unread && (
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#2196F3]" />
                )}
              </Card>
            );

            return href ? (
              <Link key={n.id} href={href} className="block">
                {card}
              </Link>
            ) : (
              <div key={n.id}>{card}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
