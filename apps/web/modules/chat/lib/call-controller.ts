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
}));

const RING_TIMEOUT_MS = 45_000;
/** ปลายสายหลุดจากห้อง (ปิดแอป/เน็ตหาย) นานเท่านี้ไม่กลับมา = วางสายให้ */
const PEER_GONE_MS = 20_000;

let room: Room | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let peerGoneTimer: ReturnType<typeof setTimeout> | null = null;
let endedTimer: ReturnType<typeof setTimeout> | null = null;
const audioEls = new Set<HTMLMediaElement>();
/** ภาพวิดีโอปัจจุบัน — จอโทรผูกเข้ากับ <video> ของตัวเองผ่าน attachVideo() */
let remoteVideoTrack: LkTrack | null = null;
let localVideoTrack: LkTrack | null = null;

function bumpVideo(patch: Partial<CallState> = {}) {
  useCallStore.setState((s) => ({ ...patch, videoRev: s.videoRev + 1 }));
}

/** ผูกภาพของเรา ("local") หรือปลายสาย ("remote") เข้ากับ <video> ของจอโทร — คืนฟังก์ชันถอด */
export function attachVideo(which: "local" | "remote", el: HTMLVideoElement): () => void {
  const track = which === "local" ? localVideoTrack : remoteVideoTrack;
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

// ─── ต่อ / ตัดห้องเสียง ───

async function connectRoom(url: string, token: string) {
  const { Room, RoomEvent, Track } = await import("livekit-client");
  const r = new Room({ adaptiveStream: false, dynacast: false, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  room = r;
  r.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Video) {
      remoteVideoTrack = track;
      bumpVideo({ remoteVideo: !track.isMuted });
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
      if (remoteVideoTrack === track) remoteVideoTrack = null;
      bumpVideo({ remoteVideo: false });
      return;
    }
    for (const el of track.detach()) {
      el.remove();
      audioEls.delete(el);
    }
  });
  // ปลายสายปิด/เปิดกล้อง (LiveKit ปิดกล้อง = mute track ไม่ได้ถอดออก)
  r.on(RoomEvent.TrackMuted, (pub, participant) => {
    if (participant !== r.localParticipant && pub.kind === Track.Kind.Video) bumpVideo({ remoteVideo: false });
  });
  r.on(RoomEvent.TrackUnmuted, (pub, participant) => {
    if (participant !== r.localParticipant && pub.kind === Track.Kind.Video) {
      if (pub.track) remoteVideoTrack = pub.track;
      bumpVideo({ remoteVideo: true });
    }
  });
  r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    useCallStore.setState({ needsAudioTap: !r.canPlaybackAudio });
  });
  r.on(RoomEvent.ParticipantConnected, () => {
    if (peerGoneTimer) clearTimeout(peerGoneTimer);
    peerGoneTimer = null;
  });
  r.on(RoomEvent.ParticipantDisconnected, () => {
    if (useCallStore.getState().phase !== "active") return;
    if (peerGoneTimer) clearTimeout(peerGoneTimer);
    peerGoneTimer = setTimeout(() => void hangUp(), PEER_GONE_MS);
  });
  r.on(RoomEvent.Disconnected, () => {
    // หลุดถาวร (LiveKit ลองต่อใหม่เองแล้วไม่สำเร็จ) — ระหว่างคุยถือว่าวางสาย
    if (room !== r) return;
    const { phase } = useCallStore.getState();
    if (phase === "active" || phase === "outgoing" || phase === "connecting") void hangUp();
  });
  await r.connect(url, token);
  await r.localParticipant.setMicrophoneEnabled(true);
  useCallStore.setState({ needsAudioTap: !r.canPlaybackAudio, muted: false });
}

function disconnectRoom() {
  const r = room;
  room = null;
  remoteVideoTrack = null;
  localVideoTrack = null;
  useCallStore.setState({ cameraOn: false, remoteVideo: false, facing: "user" });
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
  // ขอไมค์ก่อนเรียกเข้า — ปฏิเสธสิทธิ์ไมค์ = ไม่ต้องให้อีกฝั่งดังฟรี
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
  } catch (err) {
    toast.error(micError(err));
    teardown("");
    return;
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

export async function toggleMute() {
  if (!room) return;
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
