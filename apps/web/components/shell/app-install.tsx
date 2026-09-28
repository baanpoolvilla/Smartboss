"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { BellRing, Check, Copy, Download, EllipsisVertical, ExternalLink, Share, SquarePlus, X } from "lucide-react";
import { toast } from "sonner";

import {
  detectDevice,
  forgetInstalled,
  installedHint,
  installedOnAccount,
  isStandalone,
  lineExternalUrl,
  markInstalled,
  pingInstalled,
  recordStandaloneLaunch,
  useIsClient,
  type DeviceInfo,
} from "@/lib/app-install";
import { enablePush, onInstallAvailable, promptInstall, pushSupport, serverPushConfigured } from "@/lib/push-client";

/**
 * ชวนติดตั้ง SmartBoss เป็นแอป ("อยากให้คนใช้เข้ามาและโหลดมาง่ายเลย")
 *
 * - มือถือที่เปิดในเบราว์เซอร์และยังไม่เคยติดตั้ง → หน้าจอเต็มบังคับขึ้นทุกครั้งที่เปิด
 *   บอกขั้นตอนตรงกับเครื่อง (Android กดปุ่มเดียว / iPhone ทำตามขั้นตอน / LINE,
 *   Facebook ฯลฯ ต้องออกไปเปิดในเบราว์เซอร์จริงก่อน เพราะติดตั้งจากในแอปพวกนั้นไม่ได้)
 * - มีทางออก "ใช้งานในเบราว์เซอร์ไปก่อน" ซ่อนแค่รอบนี้ (sessionStorage) เปิดใหม่ขึ้นอีก —
 *   บังคับแบบไม่มีทางออกเลยไม่ได้ เพราะบางเบราว์เซอร์ติดตั้งไม่ได้จริง จะเข้าระบบไม่ได้เลย
 * - เปิดจากแอปที่ติดตั้งแล้ว / เคยติดตั้งแล้ว / คอมพิวเตอร์ → ไม่บังคับ มีปุ่มติดตั้งบนแถบบนแทน
 */

const OPEN_EVENT = "sb:open-install-guide";
const SKIP_KEY = "sb-install-skip";

/** เปิดหน้าจอแนะนำติดตั้งเอง (จากปุ่มบนแถบบน) */
function openInstallGuide() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function InstallGate() {
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(
    () =>
      onInstallAvailable((available) => {
        setCanPrompt(available);
        // Chrome ส่ง beforeinstallprompt เฉพาะตอนที่เครื่องนี้ **ยังไม่มี** แอปติดตั้งอยู่
        // ⇒ ถ้าเคยจำว่าติดตั้งแล้วแต่ยังได้เหตุการณ์นี้ แปลว่าลบแอปไปแล้ว — ลืมค่าเดิม
        // แล้วขึ้นหน้าจอติดตั้งอีกครั้ง ("ถ้าลบจะขึ้นติดตั้งใหม่ไหม") ใช้ได้กับ Android/
        // Chrome เท่านั้น iPhone ไม่มีสัญญาณแบบนี้
        if (!available || isStandalone()) return;
        forgetInstalled();
        const d = detectDevice();
        if (d.os === "desktop" || d.inApp) return;
        try {
          if (sessionStorage.getItem(SKIP_KEY) === "1") return;
        } catch {
          // ขึ้นตามปกติ
        }
        setDevice(d);
        setOpen(true);
      }),
    [],
  );

  useEffect(() => {
    // อ่านข้อมูลเครื่องได้หลังโหลดหน้าเท่านั้น (ฝั่งเซิร์ฟเวอร์ไม่มี) — ตั้ง state ในนี้ตั้งใจ
    const d = detectDevice();
    if (isStandalone()) {
      recordStandaloneLaunch();
      // บอกเซิร์ฟเวอร์ว่าบัญชีนี้ใช้แอปบนเครื่องระบบนี้อยู่ — Safari ของ iPhone เครื่องเดียวกัน
      // (คนละ storage) จะถามจากตรงนี้แทน แล้วไม่ชวนติดตั้งซ้ำ
      pingInstalled(d.os);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDevice(d);
    if (d.os === "desktop" || installedHint()) return;
    try {
      if (sessionStorage.getItem(SKIP_KEY) === "1") return;
    } catch {
      // โหมดส่วนตัว — ขึ้นตามปกติ
    }
    // บัญชีนี้เพิ่งเปิดจากแอปบนเครื่องระบบเดียวกัน (ภายใน 14 วัน) = ติดตั้งแล้ว ไม่ต้องชวน
    // ลบแอปแล้วไม่ได้เปิดอีก เลย 14 วันจะกลับมาชวนเอง
    let cancelled = false;
    void installedOnAccount(d.os).then((installed) => {
      if (!cancelled && !installed) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setDevice(detectDevice());
      setOpen(true);
    };
    const onInstalled = () => {
      markInstalled();
      setInstalled(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // ย้อนกลับ/กดลิงก์ไปหน้าอื่น = ปิดหน้าจอนี้ด้วย ("กดย้อนกลับอะไรก็เป็นแต่หน้านี้") —
  // เดิมหน้าข้างหลังเปลี่ยนแต่หน้าจอติดตั้งยังค้างทับอยู่ ต้องรีเฟรชถึงจะหาย
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = useState(pathname);
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!isClient || !open || !device) return null;

  const skip = () => {
    try {
      sessionStorage.setItem(SKIP_KEY, "1");
    } catch {
      // ซ่อนแค่ตอนนี้
    }
    setOpen(false);
  };

  const alreadyInstalled = () => {
    markInstalled();
    setOpen(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-(--bg)" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <button
        type="button"
        onClick={skip}
        aria-label="ปิด"
        title="ปิด (ใช้งานในเบราว์เซอร์ไปก่อน)"
        className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="mx-auto flex max-w-sm flex-col px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-512-v3.png" alt="" className="h-20 w-20 rounded-[22px] shadow-(--shadow-card) ring-1 ring-black/[0.06]" />
          <h1 id="install-title" className="mt-5 text-xl font-semibold text-(--ink)">
            {installed ? "ติดตั้ง SmartBoss แล้ว" : "ติดตั้งแอป SmartBoss"}
          </h1>
          <p className="mt-1.5 text-sm text-(--ink-soft)">
            {installed
              ? "เปิด SmartBoss จากไอคอนบนหน้าจอได้เลย"
              : "เปิดจากไอคอนบนหน้าจอได้ทันที เต็มจอเหมือนแอปทั่วไป และรับแจ้งเตือนงาน/แชทได้"}
          </p>
        </div>

        <div className="mt-8">
          {installed ? null : (
            <InstallSteps device={device} canPrompt={canPrompt} onInstalled={() => setInstalled(true)} />
          )}
        </div>

        {/* เปิดการแจ้งเตือนได้จากหน้านี้เลย — Android/คอม สิทธิ์แจ้งเตือนผูกกับเว็บ แอปที่ติดตั้ง
            ใช้ร่วมกับเบราว์เซอร์ อนุญาตตรงนี้ครั้งเดียวได้ทั้งคู่ · iPhone แอปบนหน้าจอโฮมแยกสิทธิ์
            จาก Safari ต้องไปเปิดในแอป (NotificationSetup ขึ้นให้เองตอนเปิดแอป) */}
        {device.os !== "ios" && !device.inApp && <GateNotifyButton />}

        <div className="mt-8 flex flex-col items-center gap-3">
          {/* iPhone: Safari ไม่มีทางรู้เองว่าติดตั้งแล้ว (แยก storage) · Android: ติดตั้งไว้
              ก่อนมีหน้าจอนี้และยังไม่เคยเปิดจากไอคอน — เปิดจากไอคอนครั้งเดียวก็จำเองแล้ว */}
          {device.os !== "desktop" && !device.inApp && !installed && (
            <button
              type="button"
              onClick={alreadyInstalled}
              className="w-full rounded-xl border border-(--line) px-4 py-3 text-sm font-medium text-(--ink) transition-colors hover:bg-(--bg-soft)"
            >
              ติดตั้งแล้ว — ไม่ต้องแสดงอีก
            </button>
          )}
          <button type="button" onClick={skip} className="text-sm text-(--ink-soft) underline-offset-4 hover:underline">
            {installed ? "ใช้งานในเบราว์เซอร์ต่อ" : "ใช้งานในเบราว์เซอร์ไปก่อน"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GateNotifyButton() {
  const [state, setState] = useState<"hidden" | "ask" | "busy" | "done" | "denied">("hidden");

  useEffect(() => {
    if (pushSupport() !== "default") return;
    let cancelled = false;
    void serverPushConfigured().then((ok) => {
      if (ok && !cancelled) setState("ask");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "hidden") return null;

  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-(--line) px-4 py-3">
      <BellRing className="h-5 w-5 shrink-0 text-[#4cb93f]" />
      <p className="min-w-0 flex-1 text-sm text-(--ink)">
        {state === "done"
          ? "เปิดการแจ้งเตือนแล้ว"
          : state === "denied"
            ? "การแจ้งเตือนถูกบล็อก — เปิดได้ที่ไอคอนแม่กุญแจข้างชื่อเว็บ"
            : "เปิดการแจ้งเตือนไว้เลย รับงาน/แชทใหม่ทันที"}
      </p>
      {(state === "ask" || state === "busy") && (
        <button
          type="button"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            const r = await enablePush().catch((err: unknown) => ({ ok: false, reason: (err as Error)?.message }));
            if (r.ok) {
              setState("done");
              return;
            }
            if (pushSupport() === "denied") {
              setState("denied");
              return;
            }
            setState("ask");
            toast.error(r.reason ?? "เปิดแจ้งเตือนไม่สำเร็จ");
          }}
          className="shrink-0 rounded-lg bg-[#4cb93f] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {state === "busy" ? "กำลังเปิด…" : "เปิด"}
        </button>
      )}
      {state === "done" && <Check className="h-5 w-5 shrink-0 text-[#4cb93f]" />}
    </div>
  );
}

function InstallSteps({
  device,
  canPrompt,
  onInstalled,
}: {
  device: DeviceInfo;
  canPrompt: boolean;
  onInstalled: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // เปิดอยู่ในเบราว์เซอร์ของแอปอื่น — ติดตั้งจากตรงนี้ไม่ได้ ต้องออกไปเบราว์เซอร์จริงก่อน
  if (device.inApp) {
    const appName =
      device.inApp === "line" ? "LINE" : device.inApp === "facebook" ? "Facebook" : device.inApp === "instagram" ? "Instagram" : device.inApp === "tiktok" ? "TikTok" : "แอปนี้";
    const browser = device.os === "ios" ? "Safari" : "Chrome";
    return (
      <div className="space-y-4">
        <Notice>
          ตอนนี้เปิดอยู่ใน {appName} ซึ่งติดตั้งแอปไม่ได้ ต้องเปิดใน {browser} ก่อน
        </Notice>
        {device.inApp === "line" ? (
          <a href={lineExternalUrl()} className={primaryButton}>
            <ExternalLink className="h-5 w-5" />
            เปิดใน {browser}
          </a>
        ) : (
          <>
            <Steps
              items={[
                <>กดปุ่ม <Kbd><EllipsisVertical className="h-3.5 w-3.5" /></Kbd> หรือ <Kbd>⋯</Kbd> ที่มุมจอ</>,
                <>เลือก <b>เปิดในเบราว์เซอร์</b> หรือ <b>เปิดใน {browser}</b></>,
                <>ทำตามขั้นตอนติดตั้งที่ขึ้นในหน้าถัดไป</>,
              ]}
            />
            <CopyLinkButton />
          </>
        )}
      </div>
    );
  }

  if (device.os === "android" && canPrompt) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await promptInstall().catch(() => false);
            setBusy(false);
            if (ok) {
              markInstalled();
              onInstalled();
            }
          }}
          className={primaryButton}
        >
          <Download className="h-5 w-5" />
          {busy ? "กำลังติดตั้ง…" : "ติดตั้งแอป"}
        </button>
        <p className="text-center text-xs text-(--ink-soft)">กดแล้วเลือก “ติดตั้ง” ในหน้าต่างที่เด้งขึ้นมา</p>
      </div>
    );
  }

  if (device.os === "android") {
    return (
      <Steps
        items={[
          <>กดปุ่มเมนู <Kbd><EllipsisVertical className="h-3.5 w-3.5" /></Kbd> มุมขวาบนของ Chrome</>,
          <>เลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b></>,
          <>กด <b>ติดตั้ง</b> แล้วเปิด SmartBoss จากไอคอนบนหน้าจอ</>,
        ]}
        footnote="ถ้าไม่เจอเมนูนี้ ให้เปิดลิงก์นี้ใน Chrome"
      />
    );
  }

  if (device.os === "ios") {
    return (
      <Steps
        items={[
          <>กดปุ่มแชร์ <Kbd><Share className="h-3.5 w-3.5" /></Kbd> ด้านล่างหรือด้านบนของจอ (บางรุ่นอยู่ในปุ่ม <Kbd>⋯</Kbd>)</>,
          <>เลื่อนลงแล้วกด <b>เพิ่มไปยังหน้าจอโฮม</b> <Kbd><SquarePlus className="h-3.5 w-3.5" /></Kbd></>,
          <>กด <b>เพิ่ม</b> แล้วเปิด SmartBoss จากไอคอนบนหน้าจอโฮม</>,
        ]}
        footnote="ถ้าไม่เจอ “เพิ่มไปยังหน้าจอโฮม” ให้เปิดลิงก์นี้ใน Safari"
      />
    );
  }

  // คอมพิวเตอร์ (เปิดจากปุ่มติดตั้งบนแถบบน แต่เบราว์เซอร์ไม่มีปุ่มติดตั้งให้เรียกตรง ๆ)
  return (
    <Steps
      items={[
        <>Chrome / Edge: กดไอคอนติดตั้ง <Kbd><Download className="h-3.5 w-3.5" /></Kbd> ท้ายช่องที่อยู่เว็บ หรือเมนู <Kbd><EllipsisVertical className="h-3.5 w-3.5" /></Kbd> → <b>ติดตั้ง SmartBoss</b></>,
        <>Safari บน Mac: เมนู <b>ไฟล์</b> → <b>เพิ่มไปยัง Dock</b></>,
        <>เปิด SmartBoss จากไอคอนบนเดสก์ท็อปหรือ Dock</>,
      ]}
      footnote="ถ้าติดตั้งไปแล้ว เปิดจากไอคอนได้เลย"
    />
  );
}

const primaryButton =
  "flex w-full items-center justify-center gap-2 rounded-xl bg-[#4cb93f] px-4 py-3.5 text-base font-semibold text-white shadow-(--shadow-card) transition-[filter] hover:brightness-105 active:brightness-95 disabled:opacity-60";

function Steps({ items, footnote }: { items: React.ReactNode[]; footnote?: string }) {
  return (
    <div>
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 rounded-xl bg-(--bg-soft) px-4 py-3 text-sm leading-relaxed text-(--ink)">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4cb93f] text-xs font-bold text-white">
              {i + 1}
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ol>
      {footnote && <p className="mt-3 text-center text-xs text-(--ink-soft)">{footnote}</p>}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-(--line) bg-(--bg) px-1 align-middle text-xs text-(--ink)">
      {children}
    </span>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-(--bg-soft) px-4 py-3 text-sm text-(--ink)">{children}</p>;
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.origin);
          setCopied(true);
        } catch {
          toast.message(window.location.origin);
        }
      }}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-(--line) px-4 py-3 text-sm font-medium text-(--ink)"
    >
      {copied ? <Check className="h-4 w-4 text-[#4cb93f]" /> : <Copy className="h-4 w-4" />}
      {copied ? "คัดลอกลิงก์แล้ว — วางในเบราว์เซอร์ได้เลย" : "คัดลอกลิงก์ SmartBoss"}
    </button>
  );
}

/**
 * ปุ่มติดตั้งบนแถบบน — ขึ้นทุกที่ที่ไม่ได้เปิดจากแอปที่ติดตั้งแล้ว
 * Chrome/Android ติดตั้งได้ตรง ๆ กดทีเดียวขึ้นหน้าต่างติดตั้ง, ที่เหลือเปิดหน้าจอแนะนำ
 */
export function InstallAppButton({ className = "" }: { className?: string }) {
  const isClient = useIsClient();
  const [canPrompt, setCanPrompt] = useState(false);
  useEffect(() => onInstallAvailable(setCanPrompt), []);

  if (!isClient || isStandalone()) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        if (canPrompt) {
          const ok = await promptInstall().catch(() => false);
          if (ok) {
            markInstalled();
            toast.success("ติดตั้ง SmartBoss แล้ว — เปิดจากไอคอนได้เลย");
          }
          return;
        }
        openInstallGuide();
      }}
      title="ติดตั้งแอป SmartBoss"
      aria-label="ติดตั้งแอป SmartBoss"
      className={`rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft) ${className}`}
    >
      <Download className="h-5 w-5" />
    </button>
  );
}
