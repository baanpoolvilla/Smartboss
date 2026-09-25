"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { useChatStore } from "../store/chat-store";
import type { ChatUser } from "../types";
import { createGroupChannel, startDm } from "../lib/api";
import { loadChannels, openChannel, useChatSync } from "../lib/chat-actions";
import { ChannelList } from "./channel-list";
import { ChatRoom } from "./chat-room";
import { NewChatDialog } from "./new-chat-dialog";
import { CHAT_BACKGROUNDS, CHAT_TEXT_SIZES, useChatPrefs, type ChatPrefs } from "../lib/prefs";
import { loadLocalMedia } from "../lib/local-media";

/** สีตัวอักษรที่อ่านออกบนสีฟองที่ผู้ใช้เลือก (สีเข้ม → ตัวขาว) */
function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#12260f";
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.6 ? "#ffffff" : "#1b2537";
}

/** รูปพื้นหลังที่ผู้ใช้เลือก (เก็บในเครื่อง) → object URL — ล้างทิ้งเมื่อเปลี่ยน/ปิดหน้า */
function useCustomBackground(prefs: ChatPrefs): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const enabled = prefs.background === "custom-image";
  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void loadLocalMedia("background").then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, prefs.mediaVersion]);
  return enabled ? url : null;
}

function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 768px)").matches
  );
}

const MOBILE_QUERY = "(max-width: 767px)";
function subscribeMobile(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/** จอมือถือ (ต่ำกว่า md) — ติดตามตอนหมุนจอ/ย่อหน้าต่างด้วย */
function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/**
 * แชทแบบ LINE — คอม: รายการห้องซ้าย + ห้องขวา · มือถือ: รายการ → กดเข้าห้องเต็มจอ
 * ห้องที่เปิดอยู่เก็บใน URL (?c=<id>) ลิงก์จากแจ้งเตือนเปิดห้องตรง ๆ ได้ และปุ่มย้อนกลับ
 * ของมือถือพากลับมารายการห้อง
 */
export function ChatApp({ currentUser }: { currentUser: ChatUser }) {
  useChatSync(currentUser.id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlChannel = searchParams.get("c");

  const channels = useChatStore((s) => s.channels);
  const loaded = useChatStore((s) => s.channelsLoaded);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActive = useChatStore((s) => s.setActive);
  const users = useChatStore((s) => s.users);
  const onlineIds = useChatStore((s) => s.onlineIds);
  const [dialogOpen, setDialogOpen] = useState(false);
  const isMobile = useIsMobile();
  const prefs = useChatPrefs();
  // ตั้งค่าหน้าตาของผู้ใช้ → ตัวแปรสีของแชท (ใช้ทั้งในหน้าและในห้องที่ถูกวาดออกไปที่ <body> บนมือถือ)
  const bgImage = useCustomBackground(prefs);
  const roomBg =
    prefs.background === "custom-color"
      ? prefs.bgColor
      : prefs.background === "custom-image"
        ? "#e8eef5"
        : CHAT_BACKGROUNDS[prefs.background].color;
  const themeStyle = {
    "--chat-room-bg": roomBg,
    "--chat-text-size": `${CHAT_TEXT_SIZES[prefs.textSize].px}px`,
    // รูปจางลงนิดหน่อย — ข้อความระบบ/เวลาที่วางบนรูปจะได้ยังอ่านออก
    "--chat-room-image": bgImage ? `linear-gradient(rgba(255,255,255,.3), rgba(255,255,255,.3)), url("${bgImage}")` : "none",
    ...(prefs.bubbleColor ? { "--chat-bubble-me": prefs.bubbleColor, "--chat-bubble-me-ink": inkFor(prefs.bubbleColor) } : {}),
  } as React.CSSProperties;
  /** จำนวนยังไม่อ่านตอนเปิดห้อง (ก่อนถูกล้าง) — ใช้วางเส้น "ยังไม่ได้อ่าน" */
  const [initialUnread, setInitialUnread] = useState<Record<string, number>>(
    {},
  );
  const openedRef = useRef<string | null>(null);

  const navigateTo = useCallback(
    (id: string | null) => {
      const url = id ? `${pathname}?c=${encodeURIComponent(id)}` : pathname;
      // มือถือ push (ย้อนกลับ = กลับรายการ) · คอม replace (สลับห้องไม่ต้องสะสมประวัติ)
      if (id && !isDesktop() && !urlChannel)
        router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [pathname, router, urlChannel],
  );

  // URL → ห้องที่เปิด
  useEffect(() => {
    if (!urlChannel) {
      if (openedRef.current) {
        openedRef.current = null;
        setActive(null);
      }
      return;
    }
    if (openedRef.current === urlChannel) return;
    openedRef.current = urlChannel;
    const unread =
      useChatStore.getState().channels.find((c) => c.id === urlChannel)
        ?.unreadCount ?? 0;
    setInitialUnread((m) => ({ ...m, [urlChannel]: unread }));
    void openChannel(urlChannel);
  }, [urlChannel, setActive]);

  // คอม: ไม่ได้ระบุห้อง → เปิดห้องบนสุดให้เลย (มือถือให้เห็นรายการก่อน)
  useEffect(() => {
    if (!urlChannel && loaded && channels.length > 0 && isDesktop())
      navigateTo(channels[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const select = useCallback(
    async (id: string) => {
      if (id.startsWith("new-dm:")) {
        try {
          const { channelId } = await startDm(id.slice("new-dm:".length));
          await loadChannels();
          navigateTo(channelId);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "เริ่มแชทไม่สำเร็จ");
        }
        return;
      }
      navigateTo(id);
    },
    [navigateTo],
  );

  const back = () => {
    if (!isDesktop() && window.history.length > 1) router.back();
    else navigateTo(null);
  };

  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;
  // ถูกนำออกจากห้อง/ห้องถูกลบระหว่างเปิดอยู่
  useEffect(() => {
    if (
      loaded &&
      activeChannelId &&
      !channels.some((c) => c.id === activeChannelId)
    ) {
      const t = setTimeout(() => {
        if (
          !useChatStore
            .getState()
            .channels.some((c) => c.id === activeChannelId)
        ) {
          toast.message("คุณไม่ได้อยู่ในห้องนี้แล้ว");
          navigateTo(null);
        }
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [loaded, activeChannelId, channels, navigateTo]);

  return (
    <div style={themeStyle} className="chat-ui flex h-full min-h-0 overflow-hidden bg-(--bg) md:rounded-2xl md:border md:border-(--line)">
      <div
        className={cn(
          "h-full min-h-0 w-full border-(--line) md:w-80 md:shrink-0 md:border-r lg:w-96",
          activeChannel ? "hidden md:block" : "block",
        )}
      >
        <ChannelList onSelect={select} onStartNew={() => setDialogOpen(true)} />
      </div>

      {/* มือถือ: เข้าห้องแล้วเต็มจอแบบ LINE — ทับแถบบนและเมนูล่างของระบบ (เมนูล่าง z-40)
          วาดออกไปที่ <body> (portal) เพราะกรอบของหน้า (AppScaffold fill = fixed z-0) ขังลำดับชั้นไว้
          ถ้าวาดอยู่ข้างใน ต่อให้ตั้ง z สูงแค่ไหน เมนูล่างของระบบก็ยังทับห้องแชท */}
      {activeChannel && isMobile ? (
        createPortal(
          <div style={themeStyle} className="chat-ui fixed inset-0 z-[45] flex h-dvh bg-(--bg) pt-[env(safe-area-inset-top)]">
            <ChatRoom
              key={activeChannel.id}
              channel={activeChannel}
              initialUnread={initialUnread[activeChannel.id] ?? 0}
              onBack={back}
            />
          </div>,
          document.body,
        )
      ) : (
        <div
          className={cn(
            "h-full min-h-0 min-w-0 flex-1",
            activeChannel ? "flex" : "hidden md:flex",
          )}
        >
          {activeChannel ? (
            <ChatRoom
              key={activeChannel.id}
              channel={activeChannel}
              initialUnread={initialUnread[activeChannel.id] ?? 0}
              onBack={back}
            />
          ) : (
            <div className="chat-room-surface flex flex-1 flex-col items-center justify-center gap-3 bg-(--chat-room-bg) text-(--ink-soft)">
              <MessagesSquare className="h-12 w-12 opacity-40" />
              <p className="text-sm">
                {urlChannel && !loaded
                  ? "กำลังโหลด…"
                  : "เลือกห้องแชททางซ้าย หรือเริ่มแชทใหม่"}
              </p>
            </div>
          )}
        </div>
      )}

      {dialogOpen && (
        <NewChatDialog
          users={Object.values(users).sort((a, b) =>
            a.name.localeCompare(b.name, "th"),
          )}
          meId={currentUser.id}
          onlineIds={onlineIds}
          onClose={() => setDialogOpen(false)}
          onStartDm={(userId) => {
            setDialogOpen(false);
            void select(`new-dm:${userId}`);
          }}
          onCreateGroup={async (name, memberIds) => {
            try {
              const { channelId } = await createGroupChannel(name, memberIds);
              setDialogOpen(false);
              await loadChannels();
              navigateTo(channelId);
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "สร้างกลุ่มไม่สำเร็จ",
              );
            }
          }}
        />
      )}
    </div>
  );
}
