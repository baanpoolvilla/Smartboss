"use client";

import { create } from "zustand";
import type { Room, Track as LkTrack } from "livekit-client";
import { toast } from "sonner";

import type { ChatCallDTO } from "../types";

/**
 * ตัวคุมสายโทรฝั่งเบราว์เซอร์ (มีได้สายเดียวต่อแท็บ) — สถานะเก็บใน store ให้จอโทร (call-manager.tsx)
 * และปุ่ม 📞 ในห้องแชทใช้ร่วมกัน · เสียงจริงต่อผ่าน LiveKit (โหลดไลบรารีตอนจะโทรเท่านั้น ไม่ถ่วงหน้าอื่น)
 *
 * ผู้โทรเข้าห้อง LiveKit ทันทีที่กดโทร (ระหว่างรอก็ต่อเสร็จแล้ว) — ปลายสายกดรับ = ได้ยินกันทันที
 */

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

interface CallState {
  /** เซิร์ฟเวอร์ตั้งค่า LiveKit แล้ว — ไม่ได้ตั้ง = ไม่มีปุ่มโทร */
  enabled: boolean;
  meId: string;
  phase: CallPhase;
  call: ChatCallDTO | null;
  muted: boolean;
  /** เบราว์เซอร์กันเล่นเสียงเอง (ยังไม่ได้แตะจอ) — ต้องแตะปุ่ม "เปิดเสียง" หนึ่งครั้ง */
  needsAudioTap: boolean;
  /** ข้อความตอนสายจบ (โชว์สั้น ๆ ก่อนปิดจอ) */
  endedLabel: string;
  /** ย่อจอโทรเป็นแถบเล็ก แชทต่อได้ระหว่างคุย */
  minimized: boolean;
  /** ความดังเสียงปลายสาย 0–1 (ปุ่มลด/เพิ่มเสียงบนจอโทร แบบ LINE) — จำไว้ในเครื่อง */
  volume: number;
  /**
   * เครื่องนี้ให้เว็บปรับความดังเองได้ไหม — Safari บน iPhone/iPad ไม่ยอม (ตั้ง volume แล้วค่ากลับเป็น 1 เสมอ)
   * ต้องใช้ปุ่มเสียงข้างเครื่อง · null = ยังไม่รู้ (ยังไม่มีเสียงปลายสาย)
   */
  volumeAdjustable: boolean | null;
  /** กล้องของเราเปิดอยู่ (เปิด/ปิดระหว่างคุยได้ แบบ Discord — สายเริ่มเป็นเสียงอย่างเดียวเสมอ) */
  cameraOn: boolean;
  /** กล้องหน้า/หลัง (มือถือ) */
  facing: "user" | "environment";
  /** ปลายสายเปิดกล้องอยู่ — จอโทรเปลี่ยนเป็นภาพวิดีโอเต็มจอ */
  remoteVideo: boolean;
  /** เพิ่มทุกครั้งที่ภาพวิดีโอ (เรา/ปลายสาย) เปลี่ยน — จอโทรใช้เป็นตัวบอกให้ผูก <video> ใหม่ */
  videoRev: number;
  /** เครื่องนี้ไม่มีไมค์ — เข้าสายได้แต่ฟังอย่างเดียว (คอมตั้งโต๊ะหลายเครื่องไม่มีไมค์) */
  noMic: boolean;
  /** เรากำลังแชร์หน้าจอ (คอมเท่านั้น — มือถือเบราว์เซอร์ไม่รองรับ) */
  sharingScreen: boolean;
  /** ภาพที่ปลายสายส่งมาคือหน้าจอ (ไม่ใช่กล้อง) — แสดงแบบเต็มภาพไม่ครอป */
  remoteIsScreen: boolean;
  /** ห้องเสียงของเราหลุด กำลังต่อกลับเข้าสายเดิม (จอดับนาน/เน็ตสลับ) */
  reconnecting: boolean;
  /** ปลายสายหลุดไป (จอดับ/เน็ตหาย) — รอให้กลับมา */
  peerAway: boolean;
}

const VOLUME_KEY = "sb.call.volume";
function savedVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
}

export const useCallStore = create<CallState>(() => ({
  enabled: false,
  meId: "",
  phase: "idle",
  call: null,
  muted: false,
  needsAudioTap: false,
  endedLabel: "",
  minimized: false,
  volume: typeof window === "undefined" ? 1 : savedVolume(),
  volumeAdjustable: null,
  cameraOn: false,
  facing: "user",
  remoteVideo: false,
  videoRev: 0,
  noMic: false,
  sharingScreen: false,
  remoteIsScreen: false,
  reconnecting: false,
  peerAway: false,
}));

const RING_TIMEOUT_MS = 45_000;
/**
 * ปลายสายหลุดจากห้อง (ปิดแอป/เน็ตหาย/จอดับ) นานเท่านี้ไม่กลับมา = วางสายให้
 * เดิม 20 วิ — ปลายสายจอดับครู่เดียว (มือถือพักหน้าเว็บ) สายก็ถูกวางทั้งสองฝั่ง (ผู้ใช้ 18/11/2569 "จอดับแล้วคุยไม่ได้เลย")
 */
const PEER_GONE_MS = 60_000;
/** ห้องเสียงของเราหลุด (จอดับนาน/เน็ตสลับ) — ลองต่อกลับเข้าสายเดิมได้นานเท่านี้ก่อนยอมวาง */
const REJOIN_WINDOW_MS = 45_000;

let room: Room | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let peerGoneTimer: ReturnType<typeof setTimeout> | null = null;
let endedTimer: ReturnType<typeof setTimeout> | null = null;
const audioEls = new Set<HTMLMediaElement>();
/** ภาพวิดีโอปัจจุบัน — จอโทรผูกเข้ากับ <video> ของตัวเองผ่าน attachVideo() */
let remoteCamTrack: LkTrack | null = null;
let remoteScreenTrack: LkTrack | null = null;
let localVideoTrack: LkTrack | null = null;
/** ภาพของปลายสายที่จะแสดง — แชร์หน้าจออยู่ = หน้าจอ ไม่งั้นกล้อง */
function remoteShown(): LkTrack | null {
  if (remoteScreenTrack && !remoteScreenTrack.isMuted) return remoteScreenTrack;
  if (remoteCamTrack && !remoteCamTrack.isMuted) return remoteCamTrack;
  return null;
}
function syncRemoteVideo() {
  const shown = remoteShown();
  bumpVideo({ remoteVideo: !!shown, remoteIsScreen: !!shown && shown === remoteScreenTrack });
}

function bumpVideo(patch: Partial<CallState> = {}) {
  useCallStore.setState((s) => ({ ...patch, videoRev: s.videoRev + 1 }));
}

/** ผูกภาพของเรา ("local") หรือปลายสาย ("remote") เข้ากับ <video> ของจอโทร — คืนฟังก์ชันถอด */
export function attachVideo(which: "local" | "remote", el: HTMLVideoElement): () => void {
  const track = which === "local" ? localVideoTrack : remoteShown();
  if (!track) return () => undefined;
  track.attach(el);
  return () => {
    track.detach(el);
  };
}

// ─── เสียงเรียกเข้า / เสียงรอสาย (สร้างด้วย WebAudio ไม่ต้องมีไฟล์เสียง) ───
let tone: { ctx: AudioContext; timer: ReturnType<typeof setInterval>; vibrate: boolean } | null = null;

function beep(ctx: AudioContext, freqs: number[], start: number, dur: number, gain: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  g.gain.setValueAtTime(gain, ctx.currentTime + start + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
  g.connect(ctx.destination);
  for (const f of freqs) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(g);
    o.start(ctx.currentTime + start);
    o.stop(ctx.currentTime + start + dur);
  }
}

function startTone(kind: "ring" | "ringback") {
  stopTone();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  void ctx.resume().catch(() => undefined);
  const play = () => {
    if (kind === "ring") {
      // ติ๊ด-ติ๊ด สองชุด ทุก 3 วินาที (คล้ายเสียงเรียกเข้ามือถือ)
      for (let i = 0; i < 4; i++) beep(ctx, [880, 1320], i * 0.18 + (i >= 2 ? 0.4 : 0), 0.14, 0.18);
      navigator.vibrate?.([400, 200, 400]);
    } else {
      // ตู๊ด… (เสียงรอสายแบบโทรศัพท์)
      beep(ctx, [440, 480], 0, 1.6, 0.08);
    }
  };
  play();
  tone = { ctx, timer: setInterval(play, kind === "ring" ? 3000 : 3600), vibrate: kind === "ring" };
}

function stopTone() {
  if (!tone) return;
  clearInterval(tone.timer);
  if (tone.vibrate) navigator.vibrate?.(0);
  void tone.ctx.close().catch(() => undefined);
  tone = null;
}

// ─── ความดังเสียงปลายสาย ───

/** ตั้งความดังให้ element เสียงของปลายสาย และเช็คว่าเครื่องยอมให้ปรับไหม (iOS ไม่ยอม ค่ากลับเป็น 1) */
function applyVolume(el: HTMLMediaElement) {
  const v = useCallStore.getState().volume;
  el.volume = v;
  if (useCallStore.getState().volumeAdjustable === null) {
    // ลองตั้งค่าที่ไม่ใช่ 1 แล้วอ่านกลับ — iOS อ่านได้ 1 เสมอ
    const probe = v === 1 ? 0.5 : v;
    el.volume = probe;
    const ok = Math.abs(el.volume - probe) < 0.01;
    el.volume = v;
    useCallStore.setState({ volumeAdjustable: ok });
  }
}

/** ลด/เพิ่มเสียงปลายสาย ทีละ 10% (ต่ำสุด 10% — ปิดเสียงทั้งหมดไม่ได้ ไม่งั้นนึกว่าสายหลุด) */
export function setVolume(next: number) {
  const v = Math.round(Math.min(1, Math.max(0.1, next)) * 10) / 10;
  useCallStore.setState({ volume: v });
  for (const el of audioEls) el.volume = v;
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* โหมดส่วนตัว — แค่ไม่จำ */
  }
}

export function changeVolume(delta: number) {
  setVolume(useCallStore.getState().volume + delta);
}

// ─── จอดับระหว่างคุย (ผู้ใช้ 18/11/2569 "โทรแล้วจอดับ คุยไม่ได้เลย ไม่ได้ยินเสียง") ───
// มือถือพักหน้าเว็บตอนจอดับ — ไมค์/เสียงหยุด เน็ตของหน้าเว็บหลุด
//  1. ระหว่างสาย ขอให้จอไม่ดับเอง (Screen Wake Lock — แบบแอปโทรทั่วไป) · จอดับเพราะกดปุ่มเองยังกันไม่ได้
//  2. กลับมาเปิดจอ: เล่นเสียงปลายสายต่อ + เปิดไมค์ใหม่ถ้าเครื่องตัดไปแล้ว
//  3. ห้องเสียงหลุด: ต่อกลับเข้าสายเดิมก่อน (ไม่วางสายทันทีเหมือนเดิม)

type WakeLockLike = { release: () => Promise<void>; released?: boolean };
let wakeLock: WakeLockLike | null = null;

async function keepScreenOn() {
  if (typeof navigator === "undefined" || document.visibilityState !== "visible") return;
  if (wakeLock && !wakeLock.released) return;
  const api = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } }).wakeLock;
  if (!api) return; // เบราว์เซอร์เก่า/บางแอป — ไม่มีให้ใช้ ข้ามไป
  try {
    wakeLock = await api.request("screen");
  } catch {
    wakeLock = null; // แบตต่ำ/โหมดประหยัด — ปฏิเสธได้ ไม่เป็นไร
  }
}

function releaseScreen() {
  const w = wakeLock;
  wakeLock = null;
  if (w && !w.released) void w.release().catch(() => undefined);
}

const inCall = () => {
  const p = useCallStore.getState().phase;
  return p === "outgoing" || p === "incoming" || p === "connecting" || p === "active";
};

/** กลับมาเปิดจอ/สลับกลับเข้าแอประหว่างคุย */
async function onVisible() {
  if (!inCall()) return;
  void keepScreenOn(); // ล็อกจอถูกปล่อยเองตอนหน้าเว็บถูกซ่อน — ขอใหม่
  const r = room;
  if (!r) return;
  // เสียงปลายสายถูกพักไว้ — เล่นต่อ (เครื่องไม่ยอม = ขึ้นปุ่ม "เปิดเสียง")
  await r.startAudio().catch(() => undefined);
  for (const el of audioEls) void el.play().catch(() => undefined);
  useCallStore.setState({ needsAudioTap: !r.canPlaybackAudio });
  // ไมค์ถูกเครื่องตัดตอนจอดับ (iPhone) — เปิดใหม่ ถ้าเราไม่ได้กดปิดไมค์เอง
  const s = useCallStore.getState();
  if (s.muted || s.noMic) return;
  try {
    const { Track } = await import("livekit-client");
    const mic = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (!mic || mic.readyState === "ended" || mic.muted) {
      await r.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await r.localParticipant.setMicrophoneEnabled(true);
    }
  } catch {
    /* เปิดไมค์ไม่ได้ — ผู้ใช้ยังกดปุ่มไมค์เองได้ */
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void onVisible();
  });
}

let recovering = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ห้องเสียงของเราหลุดระหว่างคุย — ต่อกลับเข้าสายเดิม (token ใหม่) ภายใน REJOIN_WINDOW_MS
 * ระหว่างจอดับ (หน้าเว็บถูกซ่อน) รอจนเปิดจอก่อน · สายถูกวางไปแล้ว/ต่อไม่ได้จริง = วางสาย
 */
async function recoverRoom() {
  if (recovering) return;
  const callId = useCallStore.getState().call?.id;
  if (!callId) return;
  recovering = true;
  const wasMuted = useCallStore.getState().muted;
  useCallStore.setState({ reconnecting: true });
  const deadline = Date.now() + REJOIN_WINDOW_MS;
  try {
    while (useCallStore.getState().phase === "active" && useCallStore.getState().call?.id === callId) {
      if (document.visibilityState !== "visible") {
        // จอดับอยู่ — ทำอะไรไม่ได้ รอเปิดจอ (นับเวลาเริ่มใหม่ตอนเปิดจอ ไม่งั้นจอดับนาน = วางทันทีที่เปิด)
        await new Promise<void>((resolve) => {
          const on = () => {
            if (document.visibilityState !== "visible") return;
            document.removeEventListener("visibilitychange", on);
            resolve();
          };
          document.addEventListener("visibilitychange", on);
        });
        continue;
      }
      if (Date.now() > deadline) break;
      try {
        const joined = await post<Joined>(`/api/chat/calls/${callId}/rejoin`);
        disconnectRoom();
        await connectRoom(joined.url, joined.token);
        if (wasMuted && room) {
          useCallStore.setState({ muted: true });
          await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        }
        useCallStore.setState({ call: joined.call, reconnecting: false });
        return;
      } catch (err) {
        // สายจบไปแล้ว (อีกฝั่งวาง) — ไม่ต้องลองต่อ
        if (err instanceof Error && err.message.includes("จบไปแล้ว")) {
          teardown("วางสายแล้ว");
          return;
        }
        await sleep(3000);
      }
    }
    if (useCallStore.getState().phase === "active" && useCallStore.getState().call?.id === callId) void hangUp("สายหลุด");
  } finally {
    recovering = false;
    useCallStore.setState({ reconnecting: false });
  }
}

// ─── ต่อ / ตัดห้องเสียง ───

async function connectRoom(url: string, token: string) {
  const { Room, RoomEvent, Track } = await import("livekit-client");
  const r = new Room({ adaptiveStream: false, dynacast: false, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  room = r;
  r.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Video) {
      if (track.source === Track.Source.ScreenShare) remoteScreenTrack = track;
      else remoteCamTrack = track;
      syncRemoteVideo();
      return;
    }
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.style.display = "none";
    document.body.appendChild(el);
    audioEls.add(el);
    applyVolume(el);
  });
  r.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind === Track.Kind.Video) {
      if (remoteScreenTrack === track) remoteScreenTrack = null;
      if (remoteCamTrack === track) remoteCamTrack = null;
      syncRemoteVideo();
      return;
    }
    for (const el of track.detach()) {
      el.remove();
      audioEls.delete(el);
    }
  });
  // ปลายสายปิด/เปิดกล้อง (LiveKit ปิดกล้อง = mute track ไม่ได้ถอดออก)
  r.on(RoomEvent.TrackMuted, (pub, participant) => {
    if (participant !== r.localParticipant && pub.kind === Track.Kind.Video) syncRemoteVideo();
  });
  r.on(RoomEvent.TrackUnmuted, (pub, participant) => {
    if (participant !== r.localParticipant && pub.kind === Track.Kind.Video) syncRemoteVideo();
  });
  // กดหยุดแชร์จากแถบของเบราว์เซอร์เอง ("Stop sharing") — ปุ่มบนจอโทรต้องกลับเป็นไม่แชร์
  r.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    if (pub.source === Track.Source.ScreenShare) useCallStore.setState({ sharingScreen: false });
  });
  r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    useCallStore.setState({ needsAudioTap: !r.canPlaybackAudio });
  });
  r.on(RoomEvent.ParticipantConnected, () => {
    if (peerGoneTimer) clearTimeout(peerGoneTimer);
    peerGoneTimer = null;
    useCallStore.setState({ peerAway: false });
  });
  r.on(RoomEvent.ParticipantDisconnected, () => {
    if (useCallStore.getState().phase !== "active") return;
    // ปลายสายจอดับ/เน็ตหาย — รอกลับมา (ขึ้นสถานะบนจอโทร) ไม่วางทันที
    useCallStore.setState({ peerAway: true });
    if (peerGoneTimer) clearTimeout(peerGoneTimer);
    peerGoneTimer = setTimeout(() => void hangUp("ปลายสายหลุด"), PEER_GONE_MS);
  });
  r.on(RoomEvent.Disconnected, () => {
    // หลุดถาวร (LiveKit ลองต่อใหม่เองแล้วไม่สำเร็จ)
    if (room !== r) return;
    const { phase } = useCallStore.getState();
    // ระหว่างคุย: ต่อกลับเข้าสายเดิมก่อน (เดิมวางสายทั้งสองฝั่งทันที — จอดับนิดเดียวสายก็หลุด)
    if (phase === "active") void recoverRoom();
    else if (phase === "outgoing" || phase === "connecting") void hangUp();
  });
  await r.connect(url, token);
  // ไม่มีไมค์ (คอมตั้งโต๊ะ) = เข้าสายฟังอย่างเดียว แทนที่จะโทรไม่ได้เลย · ไม่อนุญาตไมค์ = ยังเป็น error ให้ไปเปิดสิทธิ์
  let noMic = false;
  try {
    await r.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    if (!isNoMic(err)) throw err;
    noMic = true;
  }
  useCallStore.setState({ needsAudioTap: !r.canPlaybackAudio, muted: noMic, noMic });
}

function disconnectRoom() {
  const r = room;
  room = null;
  remoteCamTrack = null;
  remoteScreenTrack = null;
  localVideoTrack = null;
  useCallStore.setState({ cameraOn: false, remoteVideo: false, facing: "user", noMic: false, sharingScreen: false, remoteIsScreen: false, peerAway: false });
  if (r) void r.disconnect().catch(() => undefined);
  for (const el of audioEls) el.remove();
  audioEls.clear();
}

function clearTimers() {
  if (ringTimer) clearTimeout(ringTimer);
  if (peerGoneTimer) clearTimeout(peerGoneTimer);
  ringTimer = peerGoneTimer = null;
}

/** ปิดทุกอย่างของสายนี้ในเครื่อง แล้วโชว์ "สายจบ" แป๊บหนึ่ง (label ว่าง = ปิดจอทันที) */
function teardown(label: string) {
  clearTimers();
  stopTone();
  disconnectRoom();
  if (endedTimer) clearTimeout(endedTimer);
  if (!label) {
    useCallStore.setState({ phase: "idle", call: null, muted: false, needsAudioTap: false, minimized: false });
    return;
  }
  useCallStore.setState({ phase: "ended", endedLabel: label, needsAudioTap: false, minimized: false });
  endedTimer = setTimeout(() => useCallStore.setState({ phase: "idle", call: null, muted: false }), 1800);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "ติดต่อเซิร์ฟเวอร์ไม่ได้");
  return data;
}

type Joined = { call: ChatCallDTO; url: string; token: string };

/** เครื่องไม่มีไมค์เลย (ต่างจากไม่อนุญาต) */
function isNoMic(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError";
}

function micError(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "ไม่ได้รับอนุญาตให้ใช้ไมค์ — เปิดสิทธิ์ไมโครโฟนให้แอปก่อน";
  if (name === "NotFoundError") return "ไม่พบไมโครโฟนในเครื่องนี้";
  return err instanceof Error ? err.message : "ต่อสายไม่สำเร็จ";
}

// ─── คำสั่งจากหน้าจอ ───

export async function startCall(channelId: string, peer: { id: string; name: string }) {
  const s = useCallStore.getState();
  if (s.phase !== "idle" && s.phase !== "ended") return;
  if (endedTimer) clearTimeout(endedTimer);
  const placeholder: ChatCallDTO = {
    id: "",
    channelId,
    callerId: s.meId,
    calleeId: peer.id,
    callerName: "",
    calleeName: peer.name,
    media: "audio",
    status: "ringing",
    createdAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
  };
  useCallStore.setState({ phase: "outgoing", call: placeholder, muted: false, minimized: false });
  // ขอไมค์ก่อนเรียกเข้า — ปฏิเสธสิทธิ์ไมค์ = ไม่ต้องให้อีกฝั่งดังฟรี · ไม่มีไมค์ในเครื่อง = โทรได้ ฟังอย่างเดียว
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
  } catch (err) {
    if (isNoMic(err)) {
      toast.info("เครื่องนี้ไม่มีไมโครโฟน — โทรได้ แต่อีกฝั่งจะไม่ได้ยินเสียงคุณ");
    } else {
      toast.error(micError(err));
      teardown("");
      return;
    }
  }
  let joined: Joined;
  try {
    joined = await post<Joined>("/api/chat/calls", { channelId });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "โทรไม่สำเร็จ");
    teardown("");
    return;
  }
  // กดวางระหว่างรอเซิร์ฟเวอร์ตอบ
  if (useCallStore.getState().phase !== "outgoing") {
    void post(`/api/chat/calls/${joined.call.id}/end`).catch(() => undefined);
    return;
  }
  useCallStore.setState({ call: joined.call });
  startTone("ringback");
  ringTimer = setTimeout(() => {
    if (useCallStore.getState().phase === "outgoing") void hangUp("ไม่มีผู้รับสาย");
  }, RING_TIMEOUT_MS);
  try {
    await connectRoom(joined.url, joined.token);
  } catch (err) {
    toast.error(micError(err));
    void hangUp();
  }
}

export async function answer() {
  const { call, phase } = useCallStore.getState();
  if (!call || phase !== "incoming") return;
  stopTone();
  useCallStore.setState({ phase: "connecting" });
  try {
    const joined = await post<Joined>(`/api/chat/calls/${call.id}/answer`);
    useCallStore.setState({ call: joined.call });
    await connectRoom(joined.url, joined.token);
    if (useCallStore.getState().phase === "connecting") useCallStore.setState({ phase: "active" });
  } catch (err) {
    toast.error(micError(err));
    // รับไม่สำเร็จหลังเซิร์ฟเวอร์นับว่ารับแล้ว (เช่น ไมค์ถูกปฏิเสธ) — วางให้ อีกฝั่งจะได้ไม่รอ
    void post(`/api/chat/calls/${call.id}/end`).catch(() => undefined);
    teardown("");
  }
}

export async function decline() {
  const { call } = useCallStore.getState();
  if (!call) return;
  teardown("");
  await post(`/api/chat/calls/${call.id}/decline`).catch(() => undefined);
}

export async function hangUp(label = "วางสายแล้ว") {
  const { call } = useCallStore.getState();
  teardown(label);
  if (call?.id) await post(`/api/chat/calls/${call.id}/end`).catch(() => undefined);
}

/** แชร์หน้าจอ (แบบ Google Meet) — คอมเท่านั้น · อีกฝั่งเห็นหน้าจอเต็มจอแทนกล้อง */
export function canShareScreen(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return false;
  return "getDisplayMedia" in navigator.mediaDevices && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function toggleScreenShare() {
  if (!room) return;
  const on = !useCallStore.getState().sharingScreen;
  try {
    await room.localParticipant.setScreenShareEnabled(on, { audio: false, selfBrowserSurface: "exclude" });
    useCallStore.setState({ sharingScreen: on });
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
    // กดยกเลิกในหน้าต่างเลือกจอ = ไม่ต้องเตือน
    if (name !== "NotAllowedError" && name !== "AbortError") toast.error("แชร์หน้าจอไม่สำเร็จ");
    useCallStore.setState({ sharingScreen: false });
  }
}

export async function toggleMute() {
  if (!room) return;
  if (useCallStore.getState().noMic) {
    toast.info("เครื่องนี้ไม่มีไมโครโฟน — ต่อไมค์แล้วโทรใหม่");
    return;
  }
  const muted = !useCallStore.getState().muted;
  useCallStore.setState({ muted });
  await room.localParticipant.setMicrophoneEnabled(!muted).catch(() => useCallStore.setState({ muted: !muted }));
}

function cameraError(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้แอปก่อน";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "ไม่พบกล้องในเครื่องนี้";
  if (name === "NotReadableError") return "กล้องถูกแอปอื่นใช้อยู่";
  return "เปิดกล้องไม่สำเร็จ";
}

async function refreshLocalVideo() {
  if (!room) return;
  const { Track } = await import("livekit-client");
  const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  localVideoTrack = pub?.videoTrack ?? null;
}

/**
 * เปิด/ปิดกล้องระหว่างคุย แบบ Discord — สายเริ่มเป็นเสียง กดเปิดกล้องเมื่อไหร่ก็ได้ อีกฝั่งเห็นทันที
 * ปิดกล้อง = กลับเป็นสายเสียงตามเดิม (ไม่ต้องวางสาย)
 */
export async function toggleCamera() {
  if (!room) return;
  const on = !useCallStore.getState().cameraOn;
  try {
    await room.localParticipant.setCameraEnabled(on, { facingMode: useCallStore.getState().facing, resolution: { width: 640, height: 480 } });
    await refreshLocalVideo();
    bumpVideo({ cameraOn: on });
  } catch (err) {
    toast.error(cameraError(err));
    bumpVideo({ cameraOn: false });
  }
}

/** สลับกล้องหน้า/หลัง (มือถือ) ระหว่างเปิดกล้องอยู่ */
export async function flipCamera() {
  if (!room || !useCallStore.getState().cameraOn) return;
  const facing = useCallStore.getState().facing === "user" ? "environment" : "user";
  try {
    const { Track } = await import("livekit-client");
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.videoTrack as unknown as { restartTrack?: (o: { facingMode: string }) => Promise<void> } | undefined;
    await track?.restartTrack?.({ facingMode: facing });
    await refreshLocalVideo();
    bumpVideo({ facing });
  } catch (err) {
    toast.error(cameraError(err));
  }
}

export async function enableAudio() {
  await room?.startAudio().catch(() => undefined);
  useCallStore.setState({ needsAudioTap: room ? !room.canPlaybackAudio : false });
}

// ─── เหตุการณ์จากเซิร์ฟเวอร์ ───

/** สายเข้า (ท่อสด call.ring / เปิดจากแจ้งเตือน) */
export function onIncoming(call: ChatCallDTO, autoAnswer = false) {
  const s = useCallStore.getState();
  if (s.call?.id === call.id && s.phase !== "ended") {
    if (autoAnswer && s.phase === "incoming") void answer();
    return;
  }
  if (s.phase !== "idle" && s.phase !== "ended") return; // คุยสายอื่นอยู่ (เซิร์ฟเวอร์กันไว้แล้ว เผื่อไว้)
  if (endedTimer) clearTimeout(endedTimer);
  useCallStore.setState({ phase: "incoming", call, muted: false, minimized: false });
  if (autoAnswer) {
    void answer();
    return;
  }
  startTone("ring");
  // ไม่มีใครกด — ปิดจอเรียกเข้าเอง (ผู้โทรวางเมื่อครบเวลา → ได้ call.update ตามมาอยู่แล้ว นี่กันกรณีพลาด)
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = setTimeout(() => {
    if (useCallStore.getState().phase === "incoming") teardown("สายที่ไม่ได้รับ");
  }, RING_TIMEOUT_MS + 5_000);
}

/** สถานะสายเปลี่ยน (รับ/วาง/ปฏิเสธ) — ถึงทั้งสองฝั่ง ทุกเครื่อง */
export function onUpdate(call: ChatCallDTO) {
  const s = useCallStore.getState();
  if (s.call?.id !== call.id) return;
  if (call.status === "active") {
    if (s.phase === "outgoing") {
      // ปลายสายรับแล้ว
      clearTimers();
      stopTone();
      useCallStore.setState({ phase: "active", call });
    } else if (s.phase === "incoming") {
      // รับในเครื่องอื่นของเรา — เครื่องนี้ปิดจอเรียกเข้า
      teardown("");
    } else {
      useCallStore.setState({ call });
    }
    return;
  }
  if (s.phase === "ended" || s.phase === "idle") return;
  const label =
    call.status === "declined" ? (s.meId === call.callerId ? "ปลายสายไม่สะดวกรับ" : "") : call.status === "missed" ? (s.phase === "incoming" ? "สายที่ไม่ได้รับ" : "ไม่มีผู้รับสาย") : "วางสายแล้ว";
  teardown(label);
}

// จอไม่ดับเองตลอดสาย (เรียกเข้า/รอสาย/คุยอยู่) · จบสาย = ปล่อย
if (typeof window !== "undefined") {
  useCallStore.subscribe((s, prev) => {
    if (s.phase === prev.phase) return;
    if (inCall()) void keepScreenOn();
    else releaseScreen();
  });
}

/** เปิดแอป/รีเฟรช — ดึงสายที่ยังไม่จบของเรามาต่อ */
export async function resumeFromServer(opts: { callId?: string | null; autoAnswer?: boolean } = {}) {
  let data: { enabled: boolean; meId: string; call: ChatCallDTO | null };
  try {
    const res = await fetch("/api/chat/calls", { cache: "no-store" });
    if (!res.ok) return;
    data = (await res.json()) as typeof data;
  } catch {
    return;
  }
  useCallStore.setState({ enabled: data.enabled, meId: data.meId });
  const call = data.call;
  if (!call) return;
  if (opts.callId && call.id !== opts.callId) return;
  const s = useCallStore.getState();
  if (s.phase !== "idle" && s.phase !== "ended") return;
  if (call.status === "ringing" && call.calleeId === s.meId) {
    onIncoming(call, Boolean(opts.autoAnswer));
  } else if (call.status === "ringing") {
    // ผู้โทรรีเฟรชหน้าระหว่างเรียกเข้า — ต่อเสียงเดิมไม่ได้แล้ว วางให้ (อีกฝั่งเห็นเป็นสายที่ไม่ได้รับ)
    void post(`/api/chat/calls/${call.id}/end`).catch(() => undefined);
  } else if (call.status === "active") {
    useCallStore.setState({ phase: "connecting", call });
    try {
      const joined = await post<Joined>(`/api/chat/calls/${call.id}/rejoin`);
      await connectRoom(joined.url, joined.token);
      useCallStore.setState({ phase: "active", call: joined.call });
    } catch (err) {
      toast.error(micError(err));
      void hangUp();
    }
  }
}
