"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Download, Play } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import {
  enablePush,
  onInstallAvailable,
  promptInstall,
  pushSupport,
  type PushSupport,
} from "@/lib/push-client";
import {
  CHAT_BACKGROUNDS,
  CHAT_TEXT_SIZES,
  playChatSound,
  setChatPrefs,
  unlockChatAudio,
  useChatPrefs,
  type ChatBackground,
  type ChatSound,
  type ChatTextSize,
} from "../lib/prefs";
import { ChatModal } from "./new-chat-dialog";

const SOUNDS: { id: ChatSound; label: string }[] = [
  { id: "ding", label: "ติ๊ง" },
  { id: "pop", label: "ป๊อป" },
  { id: "bell", label: "กระดิ่ง" },
  { id: "none", label: "ปิดเสียง" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-(--line) px-4 py-4 last:border-b-0">
      <h4 className="mb-3 text-[12px] font-semibold tracking-wide text-(--ink-soft)">
        {title}
      </h4>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-(--ink)">{label}</span>
        {hint && (
          <span className="block text-[12px] text-(--ink-soft)">{hint}</span>
        )}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-(--chat-accent)/40",
          checked ? "bg-(--chat-accent)" : "bg-(--line)",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5.5" : "translate-x-0.5",
          )}
        />
      </span>
    </label>
  );
}

/**
 * ตั้งค่าแชท — เสียง, แจ้งเตือน, หน้าตา (จำไว้ต่อเครื่อง)
 * scope "system" = เปิดจากกระดิ่ง (ทุกคน รวมคนที่ไม่มีสิทธิ์แชท) — เหลือแค่เสียง/แจ้งเตือน
 * เสียงชุดเดียวกันใช้ทั้งแชทและแจ้งเตือนของทุกโมดูล (components/shell/system-notify.tsx)
 */
export function ChatSettings({
  onClose,
  scope = "chat",
}: {
  onClose: () => void;
  scope?: "chat" | "system";
}) {
  const prefs = useChatPrefs();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => onInstallAvailable(setCanInstall), []);
  useEffect(() => {
    // อ่านจาก API ของเบราว์เซอร์ได้หลังโหลดหน้าเท่านั้น
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport(pushSupport());
  }, []);

  const pushLabel =
    support === "granted"
      ? "เปิดอยู่ — เด้งแม้ปิดเว็บหรือย่อเบราว์เซอร์"
      : support === "denied"
        ? "ถูกปิดไว้ในเบราว์เซอร์ — เปิดที่ไอคอนแม่กุญแจข้างช่องที่อยู่เว็บ"
        : support === "ios-needs-install"
          ? "iPhone: กดแชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิดจากไอคอนก่อน"
          : support === "unsupported"
            ? "เบราว์เซอร์นี้ไม่รองรับ"
            : "ยังไม่ได้เปิด";

  return (
    <ChatModal
      title={scope === "system" ? "ตั้งค่าเสียงแจ้งเตือน" : "ตั้งค่าแชท"}
      onClose={onClose}
    >
      <Section title="การแจ้งเตือน">
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-(--chat-accent-strong)" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-(--ink)">แจ้งเตือนเด้งบนเครื่อง</p>
            <p className="text-[12px] text-(--ink-soft)">{pushLabel}</p>
          </div>
          {support === "default" && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await enablePush().catch(() => ({
                  ok: false,
                  reason: "เปิดแจ้งเตือนไม่สำเร็จ",
                }));
                setBusy(false);
                setSupport(pushSupport());
                if (r.ok) toast.success("เปิดแจ้งเตือนแล้ว");
                else toast.error(r.reason ?? "เปิดแจ้งเตือนไม่สำเร็จ");
              }}
              className="shrink-0 rounded-full bg-(--chat-accent) px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60"
            >
              {busy ? "กำลังเปิด…" : "เปิด"}
            </button>
          )}
          {support === "granted" && (
            <Check
              className="h-5 w-5 shrink-0 text-(--chat-accent)"
              aria-label="เปิดอยู่"
            />
          )}
        </div>

        <Toggle
          id="chat-pref-toast"
          label="เด้งกล่องแจ้งเตือนบนหน้าเว็บ"
          hint="ข้อความแชท งาน รายงาน งานซ่อม HR — ตอนเปิดเว็บอยู่"
          checked={prefs.toast}
          onChange={(v) => setChatPrefs({ toast: v })}
        />
      </Section>

      <Section title="เสียงแจ้งเตือน (ตอนเปิดเว็บอยู่ — ใช้ทั้งแชทและทุกระบบ)">
        <div className="grid grid-cols-4 gap-2">
          {SOUNDS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                unlockChatAudio();
                setChatPrefs({ sound: s.id });
                // หน่วงนิดให้ AudioContext ปลดล็อกเสร็จก่อนเล่น
                setTimeout(() => playChatSound(s.id), 60);
              }}
              aria-pressed={prefs.sound === s.id}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[12.5px]",
                prefs.sound === s.id
                  ? "border-(--chat-accent) bg-(--chat-accent-soft) font-semibold text-(--chat-accent-strong)"
                  : "border-(--line) text-(--ink-soft)",
              )}
            >
              {s.id !== "none" && <Play className="h-3.5 w-3.5" />}
              {s.label}
            </button>
          ))}
        </div>
        {prefs.sound !== "none" && (
          <label
            htmlFor="chat-pref-volume"
            className="flex items-center gap-3 text-sm text-(--ink)"
          >
            ความดัง
            <input
              id="chat-pref-volume"
              type="range"
              min={0.1}
              max={1}
              step={0.1}
              value={prefs.volume}
              onChange={(e) => setChatPrefs({ volume: Number(e.target.value) })}
              onPointerUp={() => {
                unlockChatAudio();
                setTimeout(() => playChatSound(), 60);
              }}
              className="flex-1 accent-(--chat-accent)"
            />
          </label>
        )}
        <p className="text-[12px] leading-relaxed text-(--ink-soft)">
          ตอนปิดเว็บหรือย่อเบราว์เซอร์ จะใช้เสียงแจ้งเตือนของเครื่อง
          เปลี่ยนได้ที่ตั้งค่าการแจ้งเตือนของมือถือ/คอม
        </p>
      </Section>

      {scope === "chat" && (
        <Section title="หน้าตา">
          <div>
            <p className="mb-2 text-sm text-(--ink)">ขนาดตัวอักษรในแชท</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CHAT_TEXT_SIZES) as ChatTextSize[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setChatPrefs({ textSize: k })}
                  aria-pressed={prefs.textSize === k}
                  className={cn(
                    "rounded-xl border py-2",
                    prefs.textSize === k
                      ? "border-(--chat-accent) bg-(--chat-accent-soft) font-semibold text-(--chat-accent-strong)"
                      : "border-(--line) text-(--ink-soft)",
                  )}
                  style={{ fontSize: CHAT_TEXT_SIZES[k].px }}
                >
                  {CHAT_TEXT_SIZES[k].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-(--ink)">พื้นหลังห้องแชท</p>
            <div className="flex gap-3">
              {(Object.keys(CHAT_BACKGROUNDS) as ChatBackground[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setChatPrefs({ background: k })}
                  aria-pressed={prefs.background === k}
                  className="flex flex-col items-center gap-1 text-[11.5px] text-(--ink-soft)"
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full border-2",
                      prefs.background === k
                        ? "border-(--chat-accent)"
                        : "border-(--line)",
                    )}
                    style={{ backgroundColor: CHAT_BACKGROUNDS[k].color }}
                  >
                    {prefs.background === k && (
                      <Check className="h-4 w-4 text-(--chat-accent-strong)" />
                    )}
                  </span>
                  {CHAT_BACKGROUNDS[k].label}
                </button>
              ))}
            </div>
          </div>
          <Toggle
            id="chat-pref-enter"
            label="กด Enter เพื่อส่ง (คอม)"
            hint={
              prefs.enterToSend
                ? "Shift+Enter = ขึ้นบรรทัดใหม่"
                : "Enter = ขึ้นบรรทัดใหม่ · Ctrl+Enter = ส่ง"
            }
            checked={prefs.enterToSend}
            onChange={(v) => setChatPrefs({ enterToSend: v })}
          />
        </Section>
      )}

      {canInstall && (
        <Section title="แอป">
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="flex w-full items-center gap-3 rounded-xl border border-(--line) px-3 py-2.5 text-left hover:bg-(--bg-soft)"
          >
            <Download className="h-5 w-5 text-(--chat-accent-strong)" />
            <span className="flex-1 text-sm text-(--ink)">
              ติดตั้ง SmartBoss ลงเครื่อง
            </span>
          </button>
        </Section>
      )}
    </ChatModal>
  );
}
