"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mic, MicOff, MonitorUp, MonitorX, Phone, PhoneOff, SwitchCamera, Video, VideoOff, Volume1, Volume2 } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

import { subscribeRealtime } from "@/lib/realtime-client";
import { useChatStore } from "../store/chat-store";
import type { ChatCallDTO } from "../types";
import { ChatAvatar } from "./chat-avatar";
import { answer, attachVideo, canShareScreen, changeVolume, decline, enableAudio, flipCamera, hangUp, onIncoming, onUpdate, resumeFromServer, toggleCamera, toggleMute, toggleScreenShare, useCallStore } from "../lib/call-controller";

/**
 * จอโทร (ทุกหน้า ทุกโมดูล — วางไว้ใน Shell คู่กับ ChatNotifyListener)
 * - สายเข้าตอนเปิดแอป: เต็มจอ + เสียงเรียกเข้า (ท่อสด call.ring)
 * - เปิดแอปจากแจ้งเตือนสายเข้า: ?call=<id>[&answer=1] หรือ service worker ส่ง sb-call มา (หน้าต่างเปิดอยู่แล้ว)
 * - ระหว่างคุยย่อเป็นแถบเล็กด้านบนได้ แชทต่อได้
 */
export function CallManager() {
  const {
    phase, call, muted, needsAudioTap, endedLabel, minimized, meId, volume, volumeAdjustable,
    cameraOn, remoteVideo, facing, noMic, sharingScreen, remoteIsScreen,
  } = useCallStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callId = params.get("call");
    const autoAnswer = params.get("answer") === "1";
    if (callId) {
      // เอาพารามิเตอร์ออกจากที่อยู่ — รีเฟรชทีหลังจะได้ไม่รับสายซ้ำ
      params.delete("call");
      params.delete("answer");
      const qs = params.toString();
      window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    }
    void resumeFromServer({ callId, autoAnswer });

    const off = subscribeRealtime((e) => {
      if (e.type === "call.ring") onIncoming(e.call as ChatCallDTO);
      else if (e.type === "call.update") onUpdate(e.call as ChatCallDTO);
      // หลุดท่อสดไปช่วงหนึ่ง — อาจพลาดสายเข้า
      else if (e.type === "realtime.reconnected") void resumeFromServer();
    });
    const onSwMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; callId?: unknown; answer?: unknown } | null;
      if (data?.type !== "sb-call" || typeof data.callId !== "string") return;
      void resumeFromServer({ callId: data.callId, autoAnswer: data.answer === true });
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    return () => {
      off();
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    };
  }, []);

  if (phase === "idle" || !call) return null;

  const peerId = call.callerId === meId ? call.calleeId : call.callerId;
  const peerName = (call.callerId === meId ? call.calleeName : call.callerName) || "เพื่อนร่วมงาน";

  if (minimized && phase === "active") {
    return (
      <button
        type="button"
        onClick={() => useCallStore.setState({ minimized: false })}
        className="fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-2 bg-[#06c755] px-4 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-sm font-medium text-white shadow"
      >
        <Phone className="h-4 w-4" /> {peerName} · <CallTimer since={call.answeredAt} />
        {muted && <MicOff className="h-4 w-4" />}
        {cameraOn && <Video className="h-4 w-4" />}
      </button>
    );
  }

  const status =
    phase === "outgoing"
      ? "กำลังโทร…"
      : phase === "incoming"
        ? "สายเข้า · โทรด้วยเสียง"
        : phase === "connecting"
          ? "กำลังเชื่อมต่อ…"
          : phase === "ended"
            ? endedLabel
            : null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center bg-gradient-to-b from-[#1f2a37] to-[#0b1118] px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-white">
      {/* วิดีโอแบบ Discord: ปลายสายเปิดกล้อง = ภาพเต็มจอเป็นพื้นหลัง · กล้องเรา = ภาพเล็กมุมขวาบน */}
      {phase === "active" && remoteVideo && (
        <>
          <CallVideo which="remote" className={cn("absolute inset-0 h-full w-full bg-black", remoteIsScreen ? "object-contain" : "object-cover sm:object-contain")} />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/70 to-transparent" />
        </>
      )}
      {phase === "active" && cameraOn && (
        <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/20">
          <CallVideo which="local" mirror={facing === "user"} muted className="h-40 w-28 bg-black object-cover sm:h-44 sm:w-32" />
          <button
            type="button"
            onClick={() => void flipCamera()}
            className="absolute bottom-1.5 right-1.5 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 sm:hidden"
            aria-label="สลับกล้องหน้า/หลัง"
            title="สลับกล้องหน้า/หลัง"
          >
            <SwitchCamera className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="relative flex w-full max-w-md justify-start">
        {phase === "active" && (
          <button type="button" onClick={() => useCallStore.setState({ minimized: true })} className="rounded-full p-2 text-white/80 hover:bg-white/10" aria-label="ย่อจอโทร" title="ย่อ — แชทต่อได้ระหว่างคุย">
            <ChevronDown className="h-6 w-6" />
          </button>
        )}
      </div>

      <div className={cn("relative flex flex-col items-center gap-4", phase === "active" && remoteVideo ? "mt-2" : "mt-[12vh]")}>
        {!(phase === "active" && remoteVideo) && (
          <div className={cn("rounded-full p-1.5", phase === "incoming" || phase === "outgoing" ? "animate-pulse bg-white/10" : "")}>
            <PeerAvatar id={peerId} name={peerName} />
          </div>
        )}
        <div className="text-center">
          <div className="text-2xl font-semibold">{peerName}</div>
          <div className="mt-1 text-[15px] tabular-nums text-white/70">{status ?? <CallTimer since={call.answeredAt} />}</div>
        </div>
        {noMic && phase !== "ended" && (
          <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
            <MicOff className="h-3.5 w-3.5" /> เครื่องนี้ไม่มีไมค์ — ฟังได้อย่างเดียว
          </div>
        )}
        {sharingScreen && phase === "active" && (
          <div className="flex items-center gap-1.5 rounded-full bg-[#06c755]/90 px-3 py-1 text-xs font-medium text-white">
            <MonitorUp className="h-3.5 w-3.5" /> กำลังแชร์หน้าจอของคุณ
          </div>
        )}
        {needsAudioTap && phase === "active" && (
          <button type="button" onClick={() => void enableAudio()} className="mt-2 flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
            <Volume2 className="h-4 w-4" /> แตะเพื่อเปิดเสียง
          </button>
        )}
      </div>

      {/*
        ปุ่มแบบ LINE: แถวบน = ลดเสียง · ปิดไมค์ · เพิ่มเสียง, ล่างกลาง = วางสาย (สีแดง)
        ("ให้มีลดเสียง เพิ่มเสียง ปิดไมค์ แบบฟังก์ชันโทรของไลน์") · สายเข้า = ปฏิเสธ/รับสายเหมือนเดิม
      */}
      {phase === "incoming" ? (
        <div className="mt-auto flex w-full max-w-xs items-end justify-around">
          <RoundButton label="ปฏิเสธ" className="bg-[#e5484d] hover:bg-[#d13b40]" onClick={() => void decline()}>
            <PhoneOff className="h-7 w-7" />
          </RoundButton>
          <RoundButton label="รับสาย" className="bg-[#06c755] hover:bg-[#05b34c]" onClick={() => void answer()}>
            <Phone className="h-7 w-7" />
          </RoundButton>
        </div>
      ) : phase === "ended" ? null : (
        <div className="relative mt-auto flex w-full max-w-sm flex-col items-center gap-8">
          {/* ระดับเสียงปลายสาย — iPhone ปรับจากเว็บไม่ได้ (ข้อจำกัดของ Safari) บอกให้ใช้ปุ่มข้างเครื่อง */}
          {volumeAdjustable === false ? (
            <p className="text-center text-xs text-white/60">ปรับเสียงด้วยปุ่มเสียงข้างเครื่อง</p>
          ) : (
            <div className="flex w-full max-w-[16rem] items-center gap-2" aria-label={`ระดับเสียง ${Math.round(volume * 100)}%`}>
              <Volume1 className="h-4 w-4 shrink-0 text-white/60" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${volume * 100}%` }} />
              </div>
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-white/70">{Math.round(volume * 100)}%</span>
            </div>
          )}
          <div className="flex w-full items-end justify-around">
            <RoundButton
              label="ลดเสียง"
              className="bg-white/15 hover:bg-white/25"
              onClick={() => changeVolume(-0.1)}
              disabled={volumeAdjustable === false || volume <= 0.1}
            >
              <Volume1 className="h-7 w-7" />
            </RoundButton>
            <RoundButton
              label={noMic ? "ไม่มีไมค์" : muted ? "เปิดไมค์" : "ปิดไมค์"}
              className={muted ? "bg-white text-[#1f2a37] hover:bg-white/90" : "bg-white/15 hover:bg-white/25"}
              onClick={() => void toggleMute()}
              disabled={phase === "connecting"}
            >
              {muted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
            </RoundButton>
            <RoundButton
              label={cameraOn ? "ปิดกล้อง" : "เปิดกล้อง"}
              className={cameraOn ? "bg-white text-[#1f2a37] hover:bg-white/90" : "bg-white/15 hover:bg-white/25"}
              onClick={() => void toggleCamera()}
              disabled={phase !== "active"}
            >
              {cameraOn ? <Video className="h-7 w-7" /> : <VideoOff className="h-7 w-7" />}
            </RoundButton>
            {canShareScreen() && (
              <RoundButton
                label={sharingScreen ? "หยุดแชร์จอ" : "แชร์จอ"}
                className={sharingScreen ? "bg-[#06c755] hover:bg-[#05b34c]" : "bg-white/15 hover:bg-white/25"}
                onClick={() => void toggleScreenShare()}
                disabled={phase !== "active"}
              >
                {sharingScreen ? <MonitorX className="h-7 w-7" /> : <MonitorUp className="h-7 w-7" />}
              </RoundButton>
            )}
            <RoundButton
              label="เพิ่มเสียง"
              className="bg-white/15 hover:bg-white/25"
              onClick={() => changeVolume(0.1)}
              disabled={volumeAdjustable === false || volume >= 1}
            >
              <Volume2 className="h-7 w-7" />
            </RoundButton>
          </div>
          <RoundButton label="วางสาย" className="bg-[#e5484d] hover:bg-[#d13b40]" onClick={() => void hangUp()}>
            <PhoneOff className="h-7 w-7" />
          </RoundButton>
        </div>
      )}
    </div>
  );
}

/** ผูกภาพจาก LiveKit เข้ากับ <video> — ผูกใหม่ทุกครั้งที่ภาพเปลี่ยน (videoRev) */
function CallVideo({ which, className, mirror, muted }: { which: "local" | "remote"; className: string; mirror?: boolean; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const rev = useCallStore((s) => s.videoRev);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachVideo(which, el);
  }, [which, rev]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

function PeerAvatar({ id, name }: { id: string; name: string }) {
  const src = useChatStore((s) => s.users[id]?.avatarUrl ?? null);
  return <ChatAvatar name={name} src={src} colorKey={id} className="h-28 w-28 text-4xl" />;
}

function RoundButton({ label, className, onClick, disabled, children }: { label: string; className: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cn("flex h-16 w-16 items-center justify-center rounded-full text-white transition disabled:opacity-50", className)}>
        {children}
      </button>
      <span className="text-xs text-white/80">{label}</span>
    </div>
  );
}

function CallTimer({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return <>00:00</>;
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return <>{h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`}</>;
}
