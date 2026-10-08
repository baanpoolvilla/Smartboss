"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, Lock, Volume2 } from "lucide-react";
import { Icon } from "@/components/icon";
import { cn } from "@smartboss/ui/cn";
import { ChatSettings } from "@/modules/chat/components/chat-settings";
import {
  LEVELS,
  NOTIF_MODULES,
  applyLevel,
  isCustom,
  isTopicOn,
  setTopics,
  type NotifModuleDef,
  type NotifPrefs,
} from "@/modules/notifications/prefs";
import { useNotifPrefs } from "@/modules/notifications/use-notification-prefs";

const TOTAL = NOTIF_MODULES.filter((m) => !m.locked).reduce((n, m) => n + m.topics.length, 0);

function onCount(prefs: NotifPrefs, m: NotifModuleDef) {
  return m.topics.filter((t) => isTopicOn(prefs, t.id)).length;
}

/**
 * หน้าตั้งค่าแจ้งเตือน — บนสุดเลือก "ระดับ" กดครั้งเดียว ใต้นั้นปรับเองทีละโมดูล/หัวข้อ
 * มือถือ: รายการโมดูล → กดเข้าไปหน้าหัวข้อ (?m=โมดูล — ปุ่มย้อนกลับของเครื่องพากลับรายการ)
 * คอม: ซ้ายรายการ ขวาหัวข้อของโมดูลที่เลือก
 * ทุกสวิตช์มีคำว่า "เปิด/ปิด" กำกับ · กดแล้วมีผลทันที ไม่ต้องกดบันทึก
 */
export function NotificationSettingsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefs = useNotifPrefs((s) => s.prefs);
  const loaded = useNotifPrefs((s) => s.loaded);
  const load = useNotifPrefs((s) => s.load);
  const save = useNotifPrefs((s) => s.save);
  const [soundOpen, setSoundOpen] = useState(false);

  useEffect(() => {
    // เข้าหน้านี้ = โหลดใหม่เสมอ (อาจแก้จากอีกเครื่องมา)
    void load();
  }, [load]);

  const openId = searchParams.get("m");
  const selected = NOTIF_MODULES.find((m) => m.id === openId && !m.locked) ?? null;
  // คอมเปิดโมดูลแรกไว้ให้เสมอ — มือถือไม่มี ?m = หน้ารายการ
  const desktopSelected = selected ?? NOTIF_MODULES[0]!;

  function openModule(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("m", id);
    const url = `${pathname}?${params.toString()}`;
    // คอม: สลับโมดูลในหน้าเดียว ไม่ต้องสะสมประวัติ · มือถือ: เข้าหน้าหัวข้อ ปุ่มย้อนกลับพากลับรายการ
    if (window.matchMedia("(min-width: 1024px)").matches) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }

  const custom = isCustom(prefs);
  const levelCount = (id: (typeof LEVELS)[number]["id"]) =>
    NOTIF_MODULES.filter((m) => !m.locked).reduce((n, m) => n + onCount(applyLevel(prefs, id), m), 0);

  const levelPicker = (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="ระดับการแจ้งเตือน">
      {LEVELS.map((l) => {
        const on = !custom && prefs.level === l.id;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!loaded}
            onClick={() => void save(applyLevel(prefs, l.id))}
            className={cn(
              "flex items-center gap-3 rounded-xl border-[1.5px] bg-(--bg) px-3 py-2.5 text-left transition-colors disabled:opacity-60",
              on ? "border-(--brand-green) bg-(--brand-green)/6" : "border-(--line) hover:border-(--ink-soft)/40"
            )}
          >
            <span className={cn("h-4 w-4 shrink-0 rounded-full border-2", on ? "border-[5px] border-(--brand-green)" : "border-(--ink-soft)/50")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-(--ink)">
                {l.emoji} {l.label}
              </span>
              <span className="block text-xs text-(--ink-soft)">{l.hint}</span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-(--ink-soft)">
              {levelCount(l.id)}/{TOTAL}
            </span>
          </button>
        );
      })}
      {custom && (
        <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-(--brand-green) bg-(--brand-green)/6 px-3 py-2.5" role="radio" aria-checked>
          <span className="h-4 w-4 shrink-0 rounded-full border-[5px] border-(--brand-green)" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-(--ink)">✏️ กำหนดเอง</span>
            <span className="block text-xs text-(--ink-soft)">
              ปรับเองจากระดับ “{LEVELS.find((l) => l.id === prefs.level)?.label}” · เลือกระดับด้านบนเพื่อเริ่มใหม่
            </span>
          </span>
        </div>
      )}
    </div>
  );

  const moduleList = (highlight: string | null) => (
    <div className="overflow-hidden rounded-2xl border border-(--line) bg-(--bg)">
      {NOTIF_MODULES.map((m, i) => {
        const n = onCount(prefs, m);
        const status = m.locked ? (
          <span className="flex items-center gap-1 text-[11px] text-(--ink-soft)">
            <Lock className="h-3 w-3" /> เปิดเสมอ
          </span>
        ) : n === m.topics.length ? (
          <StatusPill tone="on">เปิดทั้งหมด</StatusPill>
        ) : n === 0 ? (
          <StatusPill tone="off">ปิด</StatusPill>
        ) : (
          <StatusPill tone="part">
            เปิด {n}/{m.topics.length}
          </StatusPill>
        );
        const body = (
          <>
            <ModuleIcon m={m} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-(--ink)">{m.name}</span>
              {m.locked && <span className="block truncate text-[11px] text-(--ink-soft)">{m.topics[0]!.hint}</span>}
            </span>
            {status}
            {!m.locked && <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft) lg:hidden" />}
          </>
        );
        const cls = cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left",
          i > 0 && "border-t border-(--line)",
          !m.locked && "hover:bg-(--bg-soft)",
          highlight === m.id && "lg:bg-(--bg-soft)"
        );
        return m.locked ? (
          <div key={m.id} className={cls}>
            {body}
          </div>
        ) : (
          <button key={m.id} type="button" onClick={() => openModule(m.id)} className={cls} aria-current={highlight === m.id}>
            {body}
          </button>
        );
      })}
    </div>
  );

  const soundRow = (
    <button
      type="button"
      onClick={() => setSoundOpen(true)}
      className="flex w-full items-center gap-3 rounded-2xl border border-(--line) bg-(--bg) px-3 py-2.5 text-left hover:bg-(--bg-soft)"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--bg-soft) text-(--ink-soft)">
        <Volume2 className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-(--ink)">เสียงและการเด้งบนเครื่องนี้</span>
        <span className="block text-[11px] text-(--ink-soft)">เปลี่ยนเสียง ปิดเสียง หรือปิดกล่องเด้ง</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
    </button>
  );

  const note = (
    <p className="px-1 text-xs leading-relaxed text-(--ink-soft)">
      ปิดหัวข้อไหน = เรื่องนั้นไม่เด้ง ไม่มีเสียง ไม่ส่งมือถือ/LINE และไม่ขึ้นในกระดิ่ง ใช้กับทุกเครื่องของคุณ ·
      ตัวเลขแดงบนไอคอนโมดูลยังนับงานค้างตามเดิม · ปิดเสียงทีละห้องแชท/รีพอตทำได้ในห้องนั้น
    </p>
  );

  const detail = (m: NotifModuleDef, showBack: boolean) => {
    const n = onCount(prefs, m);
    const allOn = n > 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {showBack && (
            <button
              type="button"
              onClick={() => router.back()}
              className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft)"
              aria-label="กลับไปรายการโมดูล"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <ModuleIcon m={m} />
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-(--ink)">{m.name}</h2>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-(--line) bg-(--bg) px-3 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-(--ink)">แจ้งเตือนทั้งโมดูล</span>
            <span className="block text-[11px] text-(--ink-soft)">
              {allOn ? `เปิดอยู่ ${n} จาก ${m.topics.length} หัวข้อ · ปิดตรงนี้ = ปิดทุกหัวข้อด้านล่าง` : "ปิดอยู่ทั้งหมด · เปิดตรงนี้ = เปิดทุกหัวข้อ"}
            </span>
          </span>
          <Toggle
            on={allOn}
            disabled={!loaded}
            label={`แจ้งเตือนทั้งโมดูล ${m.name}`}
            onChange={(next) => void save(setTopics(prefs, m.topics.map((t) => t.id), next))}
          />
        </div>

        <p className="px-1 text-[11px] font-medium tracking-wide text-(--ink-soft)">หัวข้อ</p>
        <div className="overflow-hidden rounded-2xl border border-(--line) bg-(--bg)">
          {m.topics.map((t, i) => {
            const on = isTopicOn(prefs, t.id);
            return (
              <div key={t.id} className={cn("flex items-center gap-3 px-3 py-2.5", i > 0 && "border-t border-(--line)")}>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm text-(--ink)", !on && "text-(--ink-soft)")}>{t.label}</span>
                  <span className="block text-[11px] text-(--ink-soft)">{t.hint}</span>
                  {!on && t.approval && (
                    <span className="mt-0.5 block text-[11px] font-medium text-(--tone-warn,#b45309)">⚠ ปิดอยู่ — {t.approval}</span>
                  )}
                </span>
                <Toggle on={on} disabled={!loaded} label={t.label} onChange={(next) => void save(setTopics(prefs, [t.id], next))} />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* มือถือ: หน้าหัวข้อของโมดูล */}
      {selected && <div className="lg:hidden">{detail(selected, true)}</div>}

      {/* มือถือ: หน้ารายการ · คอม: ซ้าย */}
      <div className={cn("lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-8", selected && "max-lg:hidden")}>
        <div className="flex flex-col gap-4">
          <header className="flex items-center gap-2">
            <Link
              href="/notifications"
              className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft)"
              aria-label="กลับไปการแจ้งเตือน"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-(--ink)">ตั้งค่าการแจ้งเตือน</h1>
          </header>

          <section className="flex flex-col gap-2">
            <p className="px-1 text-[11px] font-medium tracking-wide text-(--ink-soft)">เลือกระดับ (กดครั้งเดียว)</p>
            {levelPicker}
          </section>

          <section className="flex flex-col gap-2">
            <p className="px-1 text-[11px] font-medium tracking-wide text-(--ink-soft)">หรือปรับเองทีละโมดูล</p>
            {moduleList(desktopSelected.id)}
          </section>

          {soundRow}
          <div className="lg:hidden">{note}</div>
        </div>

        <div className="hidden flex-col gap-4 lg:flex">
          {detail(desktopSelected, false)}
          {note}
        </div>
      </div>

      {soundOpen && <ChatSettings scope="system" onClose={() => setSoundOpen(false)} />}
    </div>
  );
}

function ModuleIcon({ m }: { m: NotifModuleDef }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: m.bg, color: m.color }}>
      <Icon name={m.icon} className="h-4 w-4" />
    </span>
  );
}

function StatusPill({ tone, children }: { tone: "on" | "off" | "part"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "on" && "bg-(--brand-green)/12 text-(--brand-green-dark)",
        tone === "off" && "bg-(--bg-soft) text-(--ink-soft)",
        tone === "part" && "bg-[#fff4e0] text-[#b45309]"
      )}
    >
      {children}
    </span>
  );
}

/** สวิตช์ที่มีคำว่า "เปิด/ปิด" กำกับ — อ่านออกโดยไม่ต้องเดาจากสี */
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex shrink-0 items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-(--brand-green)/40 disabled:opacity-60"
    >
      <span className={cn("w-6 text-right text-xs font-semibold", on ? "text-(--brand-green-dark)" : "text-(--ink-soft)")}>{on ? "เปิด" : "ปิด"}</span>
      <span className={cn("relative h-6 w-11 rounded-full transition-colors", on ? "bg-(--brand-green)" : "bg-(--line)")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", on ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  );
}
