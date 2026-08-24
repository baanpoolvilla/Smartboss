"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Input } from "@/modules/report_task/components/ui/input";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Button } from "@/modules/report_task/components/ui/button";
import { useHolidayStore, THAI_SOURCE, isSourceSelected } from "@/modules/report_task/store/holiday-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useGoogleCalendarStore, type ExternalCalendarLink, type IcsLinkTarget } from "@/modules/report_task/store/google-calendar-store";
import { PeopleCalendarList } from "./people-calendar-list";
import { cn } from "@/modules/report_task/lib/utils";
import {
  Lightbulb,
  Globe,
  Loader2,
  Search,
  Users,
  CalendarCheck2,
  Check,
  Unlink,
  HelpCircle,
  Settings,
  MousePointerClick,
  Copy,
  ClipboardPaste,
  Eye,
  ToggleRight,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import type { CalendarEvent } from "@/modules/report_task/types";

/** dd/mm/yyyy, local calendar day — `connectedAt` is a real timestamp (not a
 * date-only UTC-midnight field), so this reads local getters like the rest
 * of the app's real-timestamp formatting (dayLabelFor/groupByDay in
 * lib/format.ts), not lib/format.ts's UTC-forced `formatDate`. */
function formatLocalDMY(d: Date) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

interface Country {
  countryCode: string;
  name: string;
}

type Section = "recommended" | "people";

// "วันหยุดตามประเทศ" and "ปฏิทินภายนอก" moved to /settings (โปรไฟล์ของฉัน) —
// personal preferences, not something you set up mid-flow while adding a
// calendar. HolidaysPane/GoogleCalendarPane stay in this file (exported) and
// are reused there.
const navItems: { key: Section; label: string; icon: typeof Lightbulb }[] = [
  { key: "recommended", label: "แนะนำ", icon: Lightbulb },
  { key: "people", label: "คนในองค์กร", icon: Users },
];

export function AddCalendarDialog({
  open,
  onOpenChange,
  initialSection = "recommended",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Which pane to land on when opened — e.g. a shortcut into "คนในองค์กร"
   *  for toggling whose external calendar shows, rather than always
   *  starting from the generic "แนะนำ" landing pane. */
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  // Re-seed the pane only on the closed->open transition, computed during
  // render (not an effect) — same "adjusting state on prop change" pattern
  // used in event-detail-dialog.tsx. Switching panes inside an already-open
  // dialog shouldn't get yanked back by an unrelated re-render.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSection(initialSection);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mobile (no sm: prefix) was a fixed h-[85dvh] — a short filtered list
          (e.g. one department, 2 people) still forced the same near-full-
          screen card, leaving a huge dead blank area below the last row.
          max-h instead of h lets the card shrink to its actual content on a
          phone, only growing up to the same ceiling once there's enough
          content to need it. Desktop (sm:) keeps its original fixed height —
          not reported as an issue there, and RecommendedPane's short landing
          copy reads better in a taller card at that width. */}
      <DialogContent className="sm:max-w-3xl p-0 max-h-[85dvh] sm:h-[75vh] sm:max-h-[600px] overflow-hidden" showCloseButton>
        <div className="flex flex-col sm:flex-row max-h-[85dvh] sm:h-full min-h-0">
          <div className="w-full sm:w-52 shrink-0 border-b sm:border-b-0 sm:border-r border-[var(--line)] bg-[var(--bg-soft)]/60 p-2 sm:p-4 flex flex-row sm:flex-col gap-1 overflow-x-auto sm:overflow-y-auto min-h-0">
            <h3 className="hidden sm:block text-sm font-semibold px-2 pb-2">เพิ่มปฏิทิน</h3>
            {navItems.map((n) => (
              <button
                key={n.key}
                onClick={() => setSection(n.key)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-left transition-colors",
                  section === n.key
                    ? "bg-[var(--brand-green)] text-[var(--ink)] font-medium"
                    : "text-[var(--ink)] hover:bg-white"
                )}
              >
                <n.icon className="h-4 w-4 shrink-0" />
                {n.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 sm:p-6">
            {section === "recommended" && <RecommendedPane onNavigate={setSection} />}
            {section === "people" && <PeopleCalendarList />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecommendedPane({ onNavigate }: { onNavigate: (s: Section) => void }) {
  return (
    <div className="max-w-sm">
      <h2 className="text-2xl font-semibold leading-tight">ทีมเวิร์กทำให้งานสำเร็จ</h2>
      <p className="text-sm text-[var(--ink-soft)] mt-2">
        เลือกดูปฏิทินของเพื่อนร่วมทีม หรือเพิ่มวันหยุดราชการของประเทศที่ทีมมีสำนักงาน เข้ามาไว้ในปฏิทินของคุณเอง (ไม่กระทบปฏิทินคนอื่น)
      </p>
      <div className="flex flex-col gap-2 mt-4">
        <button
          onClick={() => onNavigate("people")}
          className="flex items-center gap-2 rounded-lg bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-sm font-medium px-4 py-2.5 w-fit transition-colors"
        >
          <Users className="h-4 w-4" /> ดูปฏิทินของทีม
        </button>
        <Link
          href="/report-task/settings?tab=profile&section=holidays"
          className="flex items-center gap-2 rounded-lg border border-[var(--line)] hover:border-[var(--brand-green)] text-sm font-medium px-4 py-2.5 w-fit transition-colors"
        >
          <Globe className="h-4 w-4" /> เพิ่มวันหยุดตามประเทศ (ไปที่หน้าตั้งค่า)
        </Link>
        <Link
          href="/report-task/settings?tab=profile&section=externalCalendar"
          className="flex items-center gap-2 rounded-lg border border-[var(--line)] hover:border-[var(--brand-green)] text-sm font-medium px-4 py-2.5 w-fit transition-colors"
        >
          <CalendarCheck2 className="h-4 w-4" /> เชื่อมต่อปฏิทินภายนอก (ไปที่หน้าตั้งค่า)
        </Link>
      </div>
    </div>
  );
}

// Nager.Date has no Thai data, so Thailand is a fixed, locally-sourced entry
// pinned above the fetched list rather than one more row inside it — same
// personal on/off toggle as every other country, just no API round-trip.
const THAILAND: Country = { countryCode: THAI_SOURCE, name: "ไทย (Thailand)" };

export function HolidaysPane() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const selectedByUser = useHolidayStore((s) => s.selectedByUser);
  const addManyHolidays = useHolidayStore((s) => s.addManyHolidays);
  const selectSource = useHolidayStore((s) => s.selectSource);
  const deselectSource = useHolidayStore((s) => s.deselectSource);
  const [countries, setCountries] = useState<Country[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState("");
  // Set (not a single code) so picking two countries before the first
  // request resolves doesn't have the first one's `finally` clear the
  // second one's still-in-flight loading indicator.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [year, setYear] = useState(String(new Date().getFullYear()));

  useEffect(() => {
    fetch("/api/report-task/holidays/countries")
      .then((r) => r.json())
      // The API returns countries sorted by ISO code (AD, AG, AI, AL...), not
      // by name — sort by name so the list actually reads alphabetically.
      .then((data) => (Array.isArray(data) ? setCountries([...data].sort((a, b) => a.name.localeCompare(b.name))) : setLoadFailed(true)))
      .catch(() => setLoadFailed(true));
  }, []);

  const isChecked = (code: string) => isSourceSelected(selectedByUser, viewingAsUserId, code);
  const filtered = countries.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
  const showThailand = THAILAND.name.toLowerCase().includes(filter.toLowerCase());

  async function toggleCountry(c: Country, checked: boolean) {
    if (!checked) {
      // Only drops it from your own selection — the underlying holiday data
      // stays cached in case anyone else (or you, later) still wants it.
      deselectSource(viewingAsUserId, c.countryCode);
      toast.success(`นำวันหยุด ${c.name} ออกจากปฏิทินของคุณแล้ว`);
      return;
    }
    // Thailand's holidays are already seeded locally — no fetch needed,
    // just turn them on for this viewer.
    if (c.countryCode === THAI_SOURCE) {
      selectSource(viewingAsUserId, THAI_SOURCE);
      toast.success("เพิ่มวันหยุดไทยเข้าปฏิทินของคุณแล้ว");
      return;
    }
    setPending((prev) => new Set(prev).add(c.countryCode));
    try {
      const res = await fetch(`/api/report-task/holidays?country=${c.countryCode}&year=${year}`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) {
        toast.error(data?.error ?? "โหลดวันหยุดไม่สำเร็จ");
        return;
      }
      if (data.length === 0) {
        toast.error(`ยังไม่มีข้อมูลวันหยุดของ ${c.name} ปี ${year} จากผู้ให้บริการ`);
        return;
      }
      const items: CalendarEvent[] = data.map((h: { date: string; localName: string; name: string }) => ({
        id: `holiday-${c.countryCode}-${h.date}`,
        title: `${h.localName}${h.name !== h.localName ? ` (${h.name})` : ""}`,
        type: "holiday",
        start: h.date,
        end: h.date,
        allDay: true,
        description: `นำเข้าจากวันหยุดราชการ ${c.name} ปี ${year}`,
      }));
      addManyHolidays(items);
      selectSource(viewingAsUserId, c.countryCode);
      toast.success(`เพิ่มวันหยุด ${c.name} ปี ${year} เข้าปฏิทินของคุณแล้ว`);
    } catch {
      toast.error("เชื่อมต่อผู้ให้บริการวันหยุดไม่ได้");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(c.countryCode);
        return next;
      });
    }
  }

  return (
    <div>
      <h3 className="text-base font-semibold">วันหยุดตามประเทศ</h3>
      <p className="text-xs text-[var(--ink-soft)] mt-1 mb-3">
        เพิ่มวันหยุดราชการหลักของแต่ละประเทศเข้าไปใน<strong>ปฏิทินของคุณเอง</strong> — แต่ละคนเลือกได้อิสระ ไม่กระทบปฏิทินคนอื่น (ข้อมูลประเทศอื่นจาก date.nager.at)
      </p>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[160px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ค้นหาประเทศ" className="pl-8" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] shrink-0">
          ปีที่นำเข้า:
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-24 h-9"
          />
        </label>
      </div>
      <p className="text-[11px] text-[var(--ink-soft)] mb-3">
        ติ๊กจะดึงวันหยุดของปี {year} มาใส่ — ถ้าอยากได้ปีอื่นด้วย เปลี่ยนปีแล้วติ๊กใหม่อีกครั้ง (ไม่ทับของเดิม)
      </p>
      {showThailand && (
        <>
          <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer text-sm w-fit font-medium">
            <Checkbox
              checked={isChecked(THAI_SOURCE)}
              onCheckedChange={(checked) => toggleCountry(THAILAND, !!checked)}
              aria-label={`เพิ่มวันหยุดของ ${THAILAND.name}`}
            />
            <span>{THAILAND.name}</span>
          </label>
          <div className="h-px bg-[var(--line)] my-2" />
        </>
      )}
      {loadFailed && <p className="text-sm text-[var(--chart-red)]">โหลดรายชื่อประเทศไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
      {!loadFailed && countries.length === 0 && (
        <p className="text-sm text-[var(--ink-soft)] flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลดรายชื่อประเทศ...</p>
      )}
      {/* columns-2 (not grid-cols-2) so the list flows down one column before
          starting the next, matching a normal alphabetical read order —
          a row-major grid would zigzag consecutive names across columns. */}
      <div className="columns-2 gap-x-4 max-w-2xl">
        {filtered.map((c) => (
          <label key={c.countryCode} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer text-sm break-inside-avoid">
            {pending.has(c.countryCode) ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : (
              <Checkbox
                checked={isChecked(c.countryCode)}
                onCheckedChange={(checked) => toggleCountry(c, !!checked)}
                aria-label={`เพิ่มวันหยุดของ ${c.name}`}
              />
            )}
            <span className="truncate">{c.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function GoogleCalendarPane() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const linksByUser = useGoogleCalendarStore((s) => s.linksByUser);
  const lastSyncedAt = useGoogleCalendarStore((s) => s.lastSyncedAt);
  const setLinks = useGoogleCalendarStore((s) => s.setLinks);
  const removeLink = useGoogleCalendarStore((s) => s.removeLink);
  const setLinkVisible = useGoogleCalendarStore((s) => s.setLinkVisible);
  const requestResync = useGoogleCalendarStore((s) => s.requestResync);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [icsUrl, setIcsUrl] = useState("");
  const [newShared, setNewShared] = useState(true);
  const [saving, setSaving] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ExternalCalendarLink | null>(null);

  const links = linksByUser[viewingAsUserId] ?? [];

  // The store's link list is a local echo — confirm against the server
  // (which holds the actual saved links, per user) so a link removed
  // out-of-band, or added from a different browser, doesn't leave this tab
  // out of sync. Re-checks whenever the "viewing as" identity switches,
  // since that's a different person's connections.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/report-task/google-calendar/status?userId=${viewingAsUserId}`)
      .then((r) => r.json())
      .then((data: { links: ExternalCalendarLink[] }) => {
        // Guards against a fast identity switch where an older request for
        // a previous viewer resolves after a newer one and overwrites it
        // with stale data.
        if (!cancelled) setLinks(viewingAsUserId, data.links ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewingAsUserId, setLinks]);

  async function handleRemove(linkId: string) {
    setRemovingId(linkId);
    try {
      await fetch(`/api/report-task/google-calendar/link?userId=${viewingAsUserId}&linkId=${linkId}`, { method: "DELETE" });
      removeLink(viewingAsUserId, linkId);
      requestResync();
      toast.success("ยกเลิกการเชื่อมต่อแล้ว");
    } catch {
      toast.error("ยกเลิกการเชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleSaveLink() {
    if (!icsUrl.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/report-task/google-calendar/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only "work" is offered anymore — syncing an outside calendar into
        // the วันลา/วันหยุด tab was removed (auto-detecting routine days off
        // from it caused more confusion than it saved).
        body: JSON.stringify({ userId: viewingAsUserId, url: icsUrl.trim(), target: "work" satisfies IcsLinkTarget, shared: newShared }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "เชื่อมต่อไม่สำเร็จ");
        return;
      }
      setLinks(viewingAsUserId, [...links, data.link]);
      setIcsUrl("");
      requestResync();
      toast.success(`เชื่อมต่อ ${data.link.label} แล้ว`);
    } catch {
      toast.error("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeVisible(linkId: string, visible: boolean) {
    const previous = links.find((l) => l.id === linkId)?.visible;
    setLinkVisible(viewingAsUserId, linkId, visible);
    try {
      const res = await fetch("/api/report-task/google-calendar/link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: viewingAsUserId, linkId, visible }),
      });
      if (!res.ok) throw new Error();
      requestResync();
    } catch {
      // Roll the optimistic flip back — otherwise the toggle stays on the
      // new value locally while the server still has the old one.
      if (previous !== undefined) setLinkVisible(viewingAsUserId, linkId, previous);
      toast.error("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }

  return (
    <div className="max-w-md">
      <h3 className="text-base font-semibold">ปฏิทินภายนอก</h3>
      <p className="text-xs text-[var(--ink-soft)] mt-1 mb-4">
        เชื่อมปฏิทิน <strong>ของตัวเอง</strong> จาก Google, Outlook หรือ Apple/iCloud ได้อิสระ — เชื่อมได้{" "}
        <strong>มากกว่า 1 ปฏิทิน</strong> พร้อมกัน แต่ละอันเลือกได้ว่าจะ <strong>&quot;เฉพาะฉัน&quot;</strong> หรือ{" "}
        <strong>&quot;แชร์ให้ทีม&quot;</strong> (เหมือนวันลาปกติ ทุกคนเห็นและซ่อนเองได้ที่แท็บ &quot;คนในองค์กร&quot;) เห็นอย่างเดียว
        แก้ไข/ลบจากในนี้ไม่ได้ ระบบดึงข้อมูลใหม่เป็นระยะขณะเปิดหน้าปฏิทินอยู่
      </p>

      {links.length > 0 && (
        <div className="space-y-2 mb-4">
          {links.map((link) => {
            return (
              <div key={link.id} className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center text-[#4285F4] shrink-0">
                    <Check className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{link.label}</p>
                    <p className="text-[11px] text-[var(--ink-soft)]">
                      ตั้งแต่ {formatLocalDMY(new Date(link.connectedAt))}
                      {lastSyncedAt && ` · ซิงค์ล่าสุด ${new Date(lastSyncedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`}
                    </p>
                  </div>
                  <button
                    onClick={() => setRemoveTarget(link)}
                    disabled={removingId === link.id}
                    title="ยกเลิกการเชื่อมต่อ"
                    className="text-[var(--chart-red)] hover:opacity-70 disabled:opacity-40 shrink-0"
                  >
                    {removingId === link.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-11">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[var(--ink-soft)]">ให้ใครเห็น:</span>
                    <ShareToggle value={link.visible} onChange={(v) => handleChangeVisible(link.id, v)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยกเลิกการเชื่อมต่อ &quot;{removeTarget?.label}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              ปฏิทินนี้จะไม่ถูกดึงข้อมูลเข้ามาอีก ถ้าต้องการดูใหม่ต้องเชื่อมต่อลิงก์นี้ซ้ำ
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={() => {
                if (removeTarget) handleRemove(removeTarget.id);
                setRemoveTarget(null);
              }}
            >
              ยกเลิกการเชื่อมต่อ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="rounded-xl border border-dashed border-[var(--line)] p-5 flex flex-col items-start gap-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Plus className="h-4 w-4 text-[var(--brand-green-dark)]" />
          {links.length > 0 ? "เพิ่มอีกปฏิทิน" : "เพิ่มปฏิทินภายนอก"}
        </p>
        <p className="text-sm text-[var(--ink-soft)]">
          วางลิงก์ iCal (<strong>&quot;Secret address in iCal format&quot;</strong> ของ Google, หรือลิงก์ปฏิทินแบบเผยแพร่ของ
          Outlook/Apple) ด้านล่าง
        </p>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
        >
          <HelpCircle className="h-3.5 w-3.5" /> ไม่รู้จะหาลิงก์นี้ยังไง? ดูวิธีการแบบละเอียด
        </button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--ink-soft)]">ให้ใครเห็น:</span>
            <ShareToggle value={newShared} onChange={setNewShared} />
          </div>
        </div>
        <div className="flex items-center gap-2 w-full">
          <Input
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveLink()}
            placeholder="https://calendar.google.com/calendar/ical/... หรือลิงก์ .ics อื่น"
            className="text-xs"
          />
          <Button
            onClick={handleSaveLink}
            disabled={saving || !icsUrl.trim()}
            className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white shrink-0"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck2 className="h-4 w-4" />}
            เชื่อมต่อ
          </Button>
        </div>
      </div>

      <ProviderGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

function ShareToggle({ value, onChange }: { value: boolean; onChange: (shared: boolean) => void }) {
  const options: { key: string; shared: boolean; label: string }[] = [
    { key: "private", shared: false, label: "เฉพาะฉัน" },
    { key: "team", shared: true, label: "แชร์ให้ทีม" },
  ];
  return (
    <div className="inline-flex rounded-md bg-[var(--bg-soft)] p-0.5 text-[11px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.shared)}
          className={cn(
            "rounded px-2 py-1 font-medium transition-colors",
            value === o.shared ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type GuideProvider = "google" | "outlook" | "other";

const guideProviders: { key: GuideProvider; label: string }[] = [
  { key: "google", label: "Google" },
  { key: "outlook", label: "Outlook" },
  { key: "other", label: "Other (Paste iCal URL)" },
];

function ProviderGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [provider, setProvider] = useState<GuideProvider>("google");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>วิธีหาลิงก์ iCal</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1.5 rounded-lg bg-[var(--bg-soft)] p-1">
          {guideProviders.map((p) => (
            <button
              key={p.key}
              onClick={() => setProvider(p.key)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                provider === p.key ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {provider === "google" && <GoogleGuideSteps />}
        {provider === "outlook" && <OutlookGuideSteps />}
        {provider === "other" && <OtherGuideSteps />}
        <Button onClick={() => onOpenChange(false)} className="w-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white">
          เข้าใจแล้ว
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function GoogleGuideSteps() {
  return (
    <ol className="space-y-4">
      <GuideStep icon={Globe} n={1} title="เปิด Google Calendar">
        เข้า{" "}
        <a href="https://calendar.google.com" target="_blank" rel="noreferrer" className="text-[var(--brand-green-dark)] hover:underline font-medium">
          calendar.google.com
        </a>{" "}
        แล้วล็อกอินด้วยบัญชีที่ต้องการดึงกำหนดการมา
      </GuideStep>
      <GuideStep icon={Settings} n={2} title="คลิกไอคอนเฟือง แล้วเลือก Settings">
        มุมขวาบนของหน้าจอ คลิกไอคอนรูปเฟือง <strong>⚙️</strong> จะมีเมนูเด้งลงมา (Settings, Trash, Appearance, Print, Get
        add-ons) — คลิกบรรทัดบนสุด <strong>&quot;Settings&quot;</strong>
        <GuideShot>
          <div className="flex items-center justify-end gap-3 pb-1.5 border-b border-white/10">
            <Search className="h-3 w-3 text-white/30" />
            <span className="relative flex items-center justify-center h-4 w-4 rounded-full ring-2 ring-[var(--brand-green)]">
              <Settings className="h-3 w-3 text-white" />
            </span>
          </div>
          <div className="mt-1.5 ml-auto w-28 rounded-md bg-[#2d2e30] p-1 space-y-0.5">
            <div className="rounded px-1.5 py-1 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25">Settings</div>
            <div className="px-1.5 py-1 text-white/40">Trash</div>
            <div className="px-1.5 py-1 text-white/40">Appearance</div>
            <div className="px-1.5 py-1 text-white/40">Print</div>
          </div>
        </GuideShot>
      </GuideStep>
      <GuideStep icon={MousePointerClick} n={3} title="ในเมนูซ้าย คลิกชื่อปฏิทินของคุณ">
        เลื่อนลงมาหาหัวข้อ <strong>&quot;Settings for my calendars&quot;</strong> ทางซ้ายมือ แล้วคลิก
        <strong>ชื่อ/อีเมลปฏิทินของคุณเอง</strong> (ไม่ใช่ &quot;General&quot; ที่เปิดมาแต่แรก) — จะมีเมนูย่อยเด้งออกมาใต้ชื่อนั้น
        <GuideShot>
          <div className="text-white/40 mb-1">Settings for my calendars</div>
          <div className="rounded px-1.5 py-1 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25 w-fit">parguy2544 (ปฏิทินของคุณ)</div>
          <div className="px-1.5 py-1 text-white/40">Birthdays</div>
        </GuideShot>
      </GuideStep>
      <GuideStep icon={Copy} n={4} title='คลิก "Integrate calendar" แล้วคัดลอกลิงก์ลับ'>
        ในเมนูย่อยที่เด้งออกมา คลิก <strong>&quot;Integrate calendar&quot;</strong> จากนั้นเลื่อนหาแถว{" "}
        <strong>&quot;Secret address in iCal format&quot;</strong> — คลิกไอคอนรูปตา 👁 เพื่อเปิดดูก่อน แล้วคลิกไอคอนคัดลอก 📋 ข้าง ๆ
        <p className="text-[11px] text-[var(--ink-soft)] mt-1">
          ใช้อันที่เขียนว่า <strong>&quot;Secret&quot;</strong> เท่านั้น — อย่าใช้ &quot;Public address&quot; (ใช้ได้ก็ต่อเมื่อเปิดปฏิทินเป็นสาธารณะ)
          ลิงก์ที่ถูกต้องจะขึ้นต้นด้วย https://calendar.google.com/calendar/ical/ และลงท้ายด้วย .ics
        </p>
        <GuideShot>
          <div className="pl-2 border-l border-white/10 space-y-0.5 mb-1.5">
            <div className="text-white/40 px-1 py-0.5">Calendar settings</div>
            <div className="text-white/40 px-1 py-0.5">Shared with</div>
            <div className="rounded px-1 py-0.5 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25 w-fit">Integrate calendar</div>
          </div>
          <div className="rounded bg-[#2d2e30] p-1.5 space-y-1">
            <div className="text-white/30 text-[9px]">Public address in iCal format</div>
            <div className="rounded bg-white/5 ring-1 ring-[var(--brand-green)] p-1">
              <div className="text-white/30 text-[9px]">Secret address in iCal format</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-white/70 tracking-widest">••••••••••</span>
                <span className="flex items-center gap-1 text-[var(--brand-green)]">
                  <Eye className="h-3 w-3" />
                  <Copy className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
        </GuideShot>
      </GuideStep>
      <GuideStep icon={ClipboardPaste} n={5} title="วางกลับมาที่นี่">
        กลับมาหน้านี้ วางลิงก์ในช่องด้านล่าง แล้วกด <strong>&quot;เชื่อมต่อ&quot;</strong> — เสร็จแล้ว!
      </GuideStep>
    </ol>
  );
}

function OutlookGuideSteps() {
  return (
    <ol className="space-y-4">
      <GuideStep icon={Globe} n={1} title="เปิด Outlook Calendar">
        เข้า{" "}
        <a href="https://outlook.office.com/calendar" target="_blank" rel="noreferrer" className="text-[var(--brand-green-dark)] hover:underline font-medium">
          outlook.office.com/calendar
        </a>{" "}
        (บัญชีองค์กร/Office 365) หรือ{" "}
        <a href="https://outlook.live.com/calendar" target="_blank" rel="noreferrer" className="text-[var(--brand-green-dark)] hover:underline font-medium">
          outlook.live.com/calendar
        </a>{" "}
        (บัญชีส่วนตัว) แล้วล็อกอิน
      </GuideStep>
      <GuideStep icon={Settings} n={2} title="คลิกไอคอนเฟืองมุมขวาบน">
        คลิกไอคอนรูปเฟือง <strong>⚙️</strong> มุมขวาบนของหน้าจอ (ข้าง ๆ รูปโปรไฟล์) — จะเปิดหน้าต่าง <strong>&quot;Settings&quot;</strong> ขึ้นมาทันที
        <GuideShot>
          <div className="flex items-center justify-end gap-2 pb-1">
            <span className="h-3.5 w-3.5 rounded-full bg-white/10" />
            <span className="relative flex items-center justify-center h-4 w-4 rounded-full ring-2 ring-[var(--brand-green)]">
              <Settings className="h-3 w-3 text-white" />
            </span>
            <span className="h-4 w-4 rounded-full bg-white/20" />
          </div>
        </GuideShot>
      </GuideStep>
      <GuideStep icon={MousePointerClick} n={3} title='เลือก "Calendar" ทางซ้าย แล้วคลิก "Shared calendars"'>
        ในหน้าต่าง Settings ที่เปิดขึ้นมา คลิกหัวข้อ <strong>&quot;Calendar&quot;</strong> ในเมนูซ้ายมือ (แถวบน) จากนั้นในเมนูย่อยที่โผล่ออกมา
        คลิก <strong>&quot;Shared calendars&quot;</strong>
        <GuideShot>
          <div className="flex gap-2">
            <div className="space-y-0.5 shrink-0">
              <div className="text-white/40 px-1 py-0.5">Account</div>
              <div className="text-white/40 px-1 py-0.5">General</div>
              <div className="text-white/40 px-1 py-0.5">Mail</div>
              <div className="rounded px-1 py-0.5 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25">Calendar</div>
              <div className="text-white/40 px-1 py-0.5">People</div>
            </div>
            <div className="pl-2 border-l border-white/10 space-y-0.5">
              <div className="text-white/40 px-1 py-0.5">View</div>
              <div className="text-white/40 px-1 py-0.5">Events and invitations</div>
              <div className="rounded px-1 py-0.5 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25 w-fit">Shared calendars</div>
              <div className="text-white/40 px-1 py-0.5">Customize actions</div>
            </div>
          </div>
        </GuideShot>
      </GuideStep>
      <GuideStep icon={ToggleRight} n={4} title='เลื่อนลงหา "Publish a calendar" ตั้งสิทธิ์แล้วกด Publish'>
        ในหน้า Shared calendars เลื่อนลงมาหาหัวข้อ <strong>&quot;Publish a calendar&quot;</strong> เลือกปฏิทินที่ต้องการจาก{" "}
        <strong>&quot;Select a calendar&quot;</strong> ตั้งสิทธิ์เป็น <strong>&quot;Can view all details&quot;</strong> ใน{" "}
        <strong>&quot;Select permissions&quot;</strong> แล้วกด <strong>&quot;Publish&quot;</strong>
        <GuideShot>
          <div className="rounded bg-[#2d2e30] p-1.5 space-y-1">
            <div className="text-white/30 text-[9px]">Publish a calendar</div>
            <div className="flex items-center justify-between gap-1">
              <span className="text-white/70 text-[9px]">Select a calendar ▾</span>
              <span className="text-white/70 text-[9px]">Can view all details ▾</span>
            </div>
            <div className="rounded px-1.5 py-0.5 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25 w-fit text-[9px]">Publish</div>
          </div>
        </GuideShot>
      </GuideStep>
      <GuideStep icon={Copy} n={5} title="คัดลอกลิงก์ที่ขึ้นต้นด้วย ICS">
        หลังกด Publish จะมีลิงก์ 2 บรรทัดโผล่ขึ้นมาใต้ปุ่ม — <strong>&quot;HTML:&quot;</strong> กับ <strong>&quot;ICS:&quot;</strong> — คัดลอกเฉพาะบรรทัด{" "}
        <strong>&quot;ICS&quot;</strong> (ลากเลือกลิงก์ทั้งหมดแล้วคัดลอก) แล้วกลับมาวางในช่องด้านล่าง กด <strong>&quot;เชื่อมต่อ&quot;</strong>
        <GuideShot>
          <div className="rounded bg-[#2d2e30] p-1.5 space-y-1 text-[9px]">
            <div className="text-white/50">HTML: https://outlook.office365.com/owa/calendar/.../calendar.html</div>
            <div className="rounded px-1 py-0.5 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25">
              ICS: https://outlook.office365.com/owa/calendar/.../calendar.ics
            </div>
          </div>
        </GuideShot>
      </GuideStep>
    </ol>
  );
}

function OtherGuideSteps() {
  return (
    <ol className="space-y-4">
      <GuideStep icon={Search} n={1} title="หาคำว่า Public / Share / Publish Calendar ในแอปนั้น ๆ">
        ปฏิทินเกือบทุกแอป (Apple/iCloud, Yahoo, Notion Calendar, Proton ฯลฯ) มีฟีเจอร์แชร์ลิงก์แบบเดียวกัน — ไปหาในหน้าตั้งค่าของปฏิทินนั้น ๆ
        คำที่มักใช้คือ <strong>&quot;Public Calendar&quot;</strong>, <strong>&quot;Share Calendar&quot;</strong>,{" "}
        <strong>&quot;Publish Calendar&quot;</strong> หรือ <strong>&quot;Subscribe / iCal / ICS link&quot;</strong>
      </GuideStep>
      <GuideStep icon={MousePointerClick} n={2} title="ตัวอย่าง: Apple/iCloud">
        เข้า{" "}
        <a href="https://www.icloud.com/calendar" target="_blank" rel="noreferrer" className="text-[var(--brand-green-dark)] hover:underline font-medium">
          icloud.com/calendar
        </a>{" "}
        → ชี้เมาส์ที่ปฏิทิน → คลิก (•••) → เปิด <strong>&quot;Public Calendar&quot;</strong> → คัดลอกลิงก์ที่ได้
        <GuideShot>
          <div className="space-y-0.5">
            <div className="flex items-center justify-between rounded px-1.5 py-1 text-white ring-1 ring-[var(--brand-green)] bg-[var(--brand-green)]/25">
              <span>parguy2544</span>
              <span className="text-white/70">•••</span>
            </div>
            <div className="px-1.5 py-1 text-white/40">Work</div>
          </div>
        </GuideShot>
      </GuideStep>
      <GuideStep icon={Copy} n={3} title='ถ้าลิงก์ขึ้นต้นด้วย "webcal://" ให้เปลี่ยนเป็น "https://"'>
        เนื้อลิงก์ส่วนที่เหลือเหมือนเดิมทุกตัวอักษร แก้แค่ช่วงแรกก่อนวาง
        <p className="text-[11px] text-[var(--ink-soft)] mt-1">
          เช่น <code className="text-[10px]">webcal://p01-calendars.icloud.com/...</code> →{" "}
          <code className="text-[10px]">https://p01-calendars.icloud.com/...</code>
        </p>
      </GuideStep>
      <GuideStep icon={ClipboardPaste} n={4} title="วางกลับมาที่นี่">
        ได้ลิงก์แล้ว กลับมาวางในช่องด้านล่าง แล้วกด <strong>&quot;เชื่อมต่อ&quot;</strong> ได้เลย
      </GuideStep>
    </ol>
  );
}

// A tiny self-contained mockup of the relevant slice of Google Calendar's
// UI (no external screenshot asset) — just enough visual layout to confirm
// "yes, this is the button" without relying on text description alone.
function GuideShot({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-lg border border-[var(--line)] bg-[#202124] p-2 text-[10px] font-sans leading-tight overflow-hidden">
      {children}
    </div>
  );
}

function GuideStep({
  icon: Icon,
  n,
  title,
  children,
}: {
  icon: React.ElementType;
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="h-7 w-7 rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)] flex items-center justify-center text-xs font-bold shrink-0">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> {title}
        </p>
        <div className="text-xs text-[var(--ink-soft)] mt-0.5 leading-relaxed">{children}</div>
      </div>
    </li>
  );
}
