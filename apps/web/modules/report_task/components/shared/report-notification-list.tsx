"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AtSign,
  Bell,
  CalendarClock,
  CheckCircle2,
  CornerDownRight,
  FileText,
  Heart,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useNotificationStore, type AppNotification } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { isOwner } from "@/modules/report_task/lib/directory";
import { relativeTime } from "@/modules/report_task/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { ReportNotificationSync } from "@/modules/report_task/components/shared/report-notification-sync";

/**
 * report_task's own notifications (@mentions, replies on your posts, task
 * reviews, issue tickets, ...) rendered on the shared /notifications page,
 * ในสไตล์คล้ายการแจ้งเตือนของ Facebook — รูปโปรไฟล์ของคนที่ทำ + ไอคอนบอก
 * ประเภท action, กลุ่ม "ใหม่" / "ก่อนหน้านี้", คลิกแล้วทำเครื่องหมายอ่านทีละอัน.
 *
 * ค่าเริ่มต้นทุกคนเห็นเฉพาะแจ้งเตือนที่เกี่ยวกับตัวเอง (ถูกแท็ก/มีคนตอบโพสต์เรา/
 * รีแอ็กชัน/งาน/ตั๋วปัญหา) ส่วนแจ้งเตือน "โพสต์ใหม่ในห้อง" (kind "room_post")
 * จะถูกส่งให้เฉพาะเจ้าของระบบ (CEO/owner) และเจ้าของระบบสลับดู "ภาพรวมทั้งหมด"
 * ได้จากสวิตช์ด้านบน.
 */

const SHOW_ALL_KEY = "sb.notif.showAll";

export type ActionMeta = { Icon: LucideIcon; color: string };

/** เดาประเภท action จาก kind + ข้อความ เพื่อเลือกไอคอน/สีของแบดจ์บนรูปโปรไฟล์ */
export function actionMetaFor(n: AppNotification): ActionMeta {
  if (n.kind === "room_post") return { Icon: FileText, color: "#3B82F6" };
  const m = n.message;
  if (m.includes("ตั๋ว") || m.includes("แจ้งปัญหา")) return { Icon: TriangleAlert, color: "#F59E0B" };
  if (m.includes("ประชุม")) return { Icon: CalendarClock, color: "#6366F1" };
  if (m.includes("เพิ่มคุณเข้าห้อง")) return { Icon: UserPlus, color: "#16A34A" };
  if (m.includes("แท็ก")) return { Icon: AtSign, color: "#8B5CF6" };
  if (m.includes("ทำเครื่องหมาย")) return { Icon: Heart, color: "#EC4899" };
  if (m.includes("ตอบกลับ")) return { Icon: CornerDownRight, color: "#16A34A" };
  if (m.includes("งาน") || m.includes("กำหนดส่ง") || m.includes("ตรวจ") || m.includes("เสร็จสิ้น"))
    return { Icon: CheckCircle2, color: "#0D9488" };
  return { Icon: Bell, color: "#6B7280" };
}

/** แจ้งเตือน "โพสต์ใหม่ในห้อง" — ปกติดูจาก kind "room_post" แต่ของเก่าที่สร้าง
 * ก่อนมี field นี้ยังไม่มี kind จึงเดาเพิ่มจากรูปแบบข้อความ (`โพสต์ใหม่ใน "…"`)
 * เพื่อให้คนทั่วไปไม่เห็นแจ้งเตือนโพสต์ข้ามแผนกที่ค้างอยู่ในระบบ */
export function isRoomPost(n: AppNotification): boolean {
  return n.kind === "room_post" || /โพสต์ใหม่ใน\s*"/.test(n.message);
}

export function ReportTaskNotificationsSection() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const notifications = useNotificationStore((s) => s.notifications);
  const employees = useEmployeeStore((s) => s.employees);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const markRead = useNotificationStore((s) => s.markRead);

  const owner = isOwner(viewingAsUserId);
  const [showAll, setShowAll] = useState(false);

  // จำค่าสวิตช์ภาพรวมไว้ในเครื่อง (เฉพาะ owner) — เริ่มหลัง mount กัน hydration mismatch
  useEffect(() => {
    if (!owner) return;
    try {
      setShowAll(localStorage.getItem(SHOW_ALL_KEY) === "1");
    } catch {
      /* private mode ฯลฯ — คงค่าเริ่มต้น เฉพาะฉัน */
    }
  }, [owner]);

  function toggleShowAll(next: boolean) {
    setShowAll(next);
    try {
      localStorage.setItem(SHOW_ALL_KEY, next ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }

  const mine = notifications
    .filter((n) => n.userId === viewingAsUserId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (mine.length === 0) return <ReportNotificationSync />;

  // owner + ภาพรวม = เห็นทุกอย่างรวม room_post, นอกนั้นเห็นเฉพาะเรื่องส่วนตัว
  const visible = owner && showAll ? mine : mine.filter((n) => !isRoomPost(n));
  const unread = visible.filter((n) => !n.read);
  const earlier = visible.filter((n) => n.read);
  const hasUnread = unread.length > 0;

  const empById = new Map(employees.map((e) => [e.id, e] as const));

  function Row({ n }: { n: AppNotification }) {
    const actor = empById.get(n.byUserId);
    const { Icon, color } = actionMetaFor(n);
    const inner = (
      <div
        className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-(--bg-soft)"
        style={!n.read ? { backgroundColor: "color-mix(in srgb, var(--brand-green) 7%, transparent)" } : undefined}
      >
        {/* รูปโปรไฟล์ของคนที่ทำ + แบดจ์ไอคอนบอกประเภท (สไตล์ Facebook) */}
        <div className="relative shrink-0">
          <Avatar size="lg">
            <AvatarImage src={actor?.avatarUrl ?? undefined} alt={actor?.name ?? ""} />
            <AvatarFallback className="bg-(--bg-soft) text-xs text-(--ink)">
              {actor?.avatar ?? "?"}
            </AvatarFallback>
          </Avatar>
          <span
            className="absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-(--bg)"
            style={{ backgroundColor: color }}
          >
            <Icon className="h-3 w-3 text-white" strokeWidth={2.5} />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-(--ink)" style={!n.read ? { fontWeight: 600 } : undefined}>
            {n.message}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            {n.topicName && (
              <span className="inline-block max-w-[10rem] truncate rounded-full bg-(--bg-soft) px-2 py-0.5 text-[11px] font-medium text-(--ink-soft)">
                {n.topicName}
              </span>
            )}
            <span
              className="text-[11px]"
              style={!n.read ? { color: "var(--brand-green-dark)", fontWeight: 600 } : { color: "var(--ink-soft)" }}
            >
              {relativeTime(n.createdAt)}
            </span>
          </div>
        </div>

        {!n.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-(--brand-green-dark)" />}
      </div>
    );

    return n.link ? (
      <Link key={n.id} href={n.link} className="block" onClick={() => markRead(n.id)}>
        {inner}
      </Link>
    ) : (
      <button key={n.id} type="button" onClick={() => markRead(n.id)} className="block w-full text-left">
        {inner}
      </button>
    );
  }

  return (
    <div className="mb-6">
      <ReportNotificationSync />

      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-(--ink-soft)">รายงานและงาน</h2>
        <div className="flex items-center gap-3">
          {owner && (
            <div className="inline-flex rounded-full border border-(--line) bg-(--bg) p-0.5 text-xs">
              <button
                type="button"
                onClick={() => toggleShowAll(false)}
                className="rounded-full px-3 py-1 font-medium transition-colors"
                style={
                  !showAll
                    ? { backgroundColor: "var(--brand-green-dark)", color: "#fff" }
                    : { color: "var(--ink-soft)" }
                }
              >
                เฉพาะฉัน
              </button>
              <button
                type="button"
                onClick={() => toggleShowAll(true)}
                className="rounded-full px-3 py-1 font-medium transition-colors"
                style={
                  showAll
                    ? { backgroundColor: "var(--brand-green-dark)", color: "#fff" }
                    : { color: "var(--ink-soft)" }
                }
              >
                ภาพรวมทั้งหมด
              </button>
            </div>
          )}
          {hasUnread && (
            <button
              type="button"
              onClick={() => markAllRead(viewingAsUserId)}
              className="whitespace-nowrap text-xs font-medium text-(--brand-green-dark) hover:underline"
            >
              อ่านทั้งหมดแล้ว
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-(--ink-soft)">
          ไม่มีการแจ้งเตือนที่เกี่ยวกับคุณ
          {owner && !showAll ? " — สลับเป็น “ภาพรวมทั้งหมด” เพื่อดูความเคลื่อนไหวทุกห้อง" : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {unread.length > 0 && (
            <div>
              <p className="mb-1 px-1 text-xs font-semibold text-(--ink)">ใหม่</p>
              <div className="flex flex-col gap-0.5">
                {unread.map((n) => (
                  <Row key={n.id} n={n} />
                ))}
              </div>
            </div>
          )}
          {earlier.length > 0 && (
            <div>
              <p className="mb-1 px-1 text-xs font-semibold text-(--ink-soft)">ก่อนหน้านี้</p>
              <div className="flex flex-col gap-0.5">
                {earlier.map((n) => (
                  <Row key={n.id} n={n} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
