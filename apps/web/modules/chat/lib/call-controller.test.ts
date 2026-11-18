import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * จอดับระหว่างคุย (ผู้ใช้ 18/11/2569 "โทรแล้วจอดับ คุยไม่ได้เลย ไม่ได้ยินเสียง")
 * จำลองห้อง LiveKit + หน้าเว็บถูกซ่อน/กลับมา — ตรวจว่าสายไม่ถูกวาง ต่อกลับเข้าสายเดิม และขอให้จอไม่ดับ
 */

// ── หน้าเว็บจำลอง (สภาพแวดล้อมเทสเป็น node) ──
const docListeners = new Map<string, Set<() => void>>();
const doc = {
  visibilityState: "visible" as "visible" | "hidden",
  addEventListener: (t: string, f: () => void) => {
    if (!docListeners.has(t)) docListeners.set(t, new Set());
    docListeners.get(t)!.add(f);
  },
  removeEventListener: (t: string, f: () => void) => docListeners.get(t)?.delete(f),
  body: { appendChild: () => undefined },
};
function setVisible(v: boolean) {
  doc.visibilityState = v ? "visible" : "hidden";
  for (const f of [...(docListeners.get("visibilitychange") ?? [])]) f();
}
const wakeRequests: string[] = [];
Object.assign(globalThis, {
  document: doc,
  window: globalThis,
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    userAgent: "test",
    vibrate: () => true,
    wakeLock: {
      request: async (t: string) => {
        wakeRequests.push(t);
        return { released: false, release: async () => undefined };
      },
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
  },
});

// ── LiveKit จำลอง ──
type Handler = (...a: unknown[]) => void;
const rooms: FakeRoom[] = [];
class FakeRoom {
  handlers = new Map<string, Handler[]>();
  canPlaybackAudio = true;
  connected = 0;
  micCalls: boolean[] = [];
  localParticipant = {
    setMicrophoneEnabled: async (on: boolean) => {
      this.micCalls.push(on);
    },
    getTrackPublication: () => ({ track: { mediaStreamTrack: { readyState: micState.value, muted: false } } }),
  };
  constructor() {
    rooms.push(this);
  }
  on(e: string, f: Handler) {
    this.handlers.set(e, [...(this.handlers.get(e) ?? []), f]);
    return this;
  }
  emit(e: string, ...a: unknown[]) {
    for (const f of this.handlers.get(e) ?? []) f(...a);
  }
  async connect() {
    this.connected++;
  }
  async disconnect() {}
  async startAudio() {}
}
const micState = { value: "live" as "live" | "ended" };
vi.mock("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: {
    TrackSubscribed: "TrackSubscribed",
    TrackUnsubscribed: "TrackUnsubscribed",
    TrackMuted: "TrackMuted",
    TrackUnmuted: "TrackUnmuted",
    LocalTrackUnpublished: "LocalTrackUnpublished",
    AudioPlaybackStatusChanged: "AudioPlaybackStatusChanged",
    ParticipantConnected: "ParticipantConnected",
    ParticipantDisconnected: "ParticipantDisconnected",
    Disconnected: "Disconnected",
  },
  Track: { Kind: { Audio: "audio", Video: "video" }, Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } },
}));
vi.mock("sonner", () => ({ toast: { error: () => undefined, info: () => undefined } }));

// ── เซิร์ฟเวอร์จำลอง ──
const posts: string[] = [];
let rejoinStatus = 200;
const activeCall = { id: "c1", channelId: "dm", callerId: "me", calleeId: "peer", callerName: "", calleeName: "", media: "audio", status: "active", createdAt: "", answeredAt: "2026-11-18T00:00:00Z", endedAt: null };
globalThis.fetch = (async (url: string) => {
  posts.push(String(url));
  if (String(url).endsWith("/rejoin") && rejoinStatus !== 200) {
    return { ok: false, json: async () => ({ error: "สายนี้จบไปแล้ว" }) } as Response;
  }
  if (String(url) === "/api/chat/calls") {
    return { ok: true, json: async () => ({ enabled: true, meId: "me", call: activeCall }) } as Response;
  }
  return { ok: true, json: async () => ({ call: activeCall, url: "wss://lk", token: "t", ok: true }) } as Response;
}) as typeof fetch;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe("call — screen off / connection drop", () => {
  let ctl: typeof import("./call-controller");
  beforeEach(async () => {
    vi.resetModules();
    rooms.length = 0;
    posts.length = 0;
    wakeRequests.length = 0;
    rejoinStatus = 200;
    micState.value = "live";
    doc.visibilityState = "visible";
    docListeners.clear();
    ctl = await import("./call-controller");
    // เข้าสายที่คุยอยู่ (แบบรีเฟรชระหว่างคุย)
    await ctl.resumeFromServer();
    await flush();
  });
  afterEach(() => vi.useRealTimers());

  it("asks the screen to stay on during a call", () => {
    expect(ctl.useCallStore.getState().phase).toBe("active");
    expect(wakeRequests).toContain("screen");
  });

  it("room drops during a call → rejoins the same call instead of hanging up", async () => {
    const first = rooms.at(-1)!;
    posts.length = 0;
    first.emit("Disconnected");
    await flush();
    expect(posts.some((u) => u.endsWith("/end"))).toBe(false);
    expect(posts.some((u) => u.endsWith("/c1/rejoin"))).toBe(true);
    expect(rooms.at(-1)).not.toBe(first);
    expect(rooms.at(-1)!.connected).toBe(1);
    expect(ctl.useCallStore.getState().phase).toBe("active");
    expect(ctl.useCallStore.getState().reconnecting).toBe(false);
  });

  it("drop while screen is off → waits for the screen, then rejoins", async () => {
    const first = rooms.at(-1)!;
    posts.length = 0;
    setVisible(false);
    first.emit("Disconnected");
    await flush();
    expect(posts.length).toBe(0);
    expect(ctl.useCallStore.getState().reconnecting).toBe(true);
    setVisible(true);
    await flush();
    expect(posts.some((u) => u.endsWith("/c1/rejoin"))).toBe(true);
    expect(posts.some((u) => u.endsWith("/end"))).toBe(false);
    expect(ctl.useCallStore.getState().phase).toBe("active");
  });

  it("call already ended by the other side → closes without calling /end again", async () => {
    rejoinStatus = 409;
    posts.length = 0;
    rooms.at(-1)!.emit("Disconnected");
    await flush();
    expect(ctl.useCallStore.getState().phase).toBe("ended");
    expect(posts.some((u) => u.endsWith("/end"))).toBe(false);
  });

  it("screen back on and the phone cut the mic → mic is turned on again", async () => {
    const r = rooms.at(-1)!;
    r.micCalls.length = 0;
    micState.value = "ended";
    setVisible(false);
    setVisible(true);
    await flush();
    expect(r.micCalls).toEqual([false, true]);
  });

  it("screen back on, mic fine but user muted → mic stays off", async () => {
    const r = rooms.at(-1)!;
    ctl.useCallStore.setState({ muted: true });
    r.micCalls.length = 0;
    micState.value = "ended";
    setVisible(false);
    setVisible(true);
    await flush();
    expect(r.micCalls).toEqual([]);
  });

  it("peer drops → shows waiting, hangs up only after 60s", async () => {
    vi.useFakeTimers();
    const r = rooms.at(-1)!;
    posts.length = 0;
    r.emit("ParticipantDisconnected");
    expect(ctl.useCallStore.getState().peerAway).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(posts.some((u) => u.endsWith("/end"))).toBe(false);
    r.emit("ParticipantConnected");
    expect(ctl.useCallStore.getState().peerAway).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts.some((u) => u.endsWith("/end"))).toBe(false);
    expect(ctl.useCallStore.getState().phase).toBe("active");
  });
});
