"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Today } from "./today";

/**
 * ตัวควบคุมตัวตนของ Mini App
 *
 * ── ทำไมต้องรองรับเบราว์เซอร์ธรรมดาด้วย ──
 * OA กลางตัวเดียว = จุดล้มเหลวจุดเดียวของลูกค้าทุกราย (LINE ล่ม / โควตาหมด /
 * OA ถูกระงับ ⇒ พนักงานทุกบริษัทเข้าไม่ได้พร้อมกัน) · หน้านี้เป็น route ธรรมดา
 * บนโดเมนเราเองอยู่แล้ว จึงเขียนให้ **ถ้า LIFF ใช้ไม่ได้ ให้ตกไปใช้อีเมล/รหัสผ่าน**
 * แทนที่จะขึ้นจอขาว — ต้นทุนตอนออกแบบไว้แต่แรกแทบเป็นศูนย์
 * (docs/line-mini-app-checkin-spec.md ข้อ 0.5)
 */

const LIFF_SDK = "https://static.line-scdn.net/liff/edge/2/sdk.js";

/** ธงกัน `liff.login()` วนเด้งไม่รู้จบ — อยู่แค่ในแท็บนี้ ปิดแล้วหายไปเอง */
const LOGIN_ATTEMPT_KEY = "sb.liff.login-attempt";

interface Liff {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(): void;
  getIDToken(): string | null;
  isInClient(): boolean;
  getFriendship(): Promise<{ friendFlag: boolean }>;
}

declare global {
  interface Window {
    liff?: Liff;
  }
}

type Phase =
  | { kind: "booting" }
  /** ยืนยันกับ LINE ได้แล้ว แต่บัญชีนี้ยังไม่เคยผูกกับพนักงานคนไหน */
  | { kind: "needs_link"; idToken: string }
  /** เข้าผ่านเบราว์เซอร์ธรรมดา หรือ LIFF ใช้ไม่ได้ */
  | { kind: "needs_login"; reason: string | null }
  | { kind: "ready"; name: string }
  | { kind: "error"; message: string };

function loadLiffSdk(): Promise<void> {
  if (window.liff) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LIFF_SDK;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("โหลด LIFF SDK ไม่สำเร็จ"));
    document.head.appendChild(script);
  });
}

export function MiniApp({ liffId, lineReady }: { liffId: string; lineReady: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [notFriend, setNotFriend] = useState(false);
  // React 18 StrictMode เรียก effect สองรอบใน dev — การ init LIFF ซ้ำทำให้
  // ขอ id token พร้อมกันสองครั้งแล้วชนกัน
  const started = useRef(false);

  const finishSignedIn = useCallback((name: string) => {
    setPhase({ kind: "ready", name });
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      // 1) มีเซสชันอยู่แล้วหรือยัง (เปิดแอปซ้ำ / เพิ่งผูกบัญชีไป)
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as { user: { name: string } };
          finishSignedIn(data.user.name);
          return;
        }
      } catch {
        // ต่อเซิร์ฟเวอร์ตัวเองไม่ได้ — ปล่อยให้ไปตกที่ทางอื่นข้างล่าง
      }

      // 2) ยังไม่ได้ตั้ง env หรือไม่มี LIFF ID ⇒ ฟีเจอร์ LINE ปิดอยู่ ไม่ใช่พัง
      if (!lineReady || liffId === "") {
        setPhase({ kind: "needs_login", reason: null });
        return;
      }

      // 3) เส้นทางปกติ: ยืนยันตัวตนผ่าน LINE
      try {
        await loadLiffSdk();
        const liff = window.liff;
        if (!liff) throw new Error("ไม่พบ LIFF SDK");

        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          if (liff.isInClient()) {
            /*
             * กันวนไม่รู้จบ — `liff.login()` พาออกไปแล้วกลับมาที่หน้าเดิม
             * ถ้ากลับมาแล้ว `isLoggedIn()` ยังเป็น false อยู่ (เช่น scope ไม่ครบ
             * หรือ endpoint ไม่ตรงกับที่ลงทะเบียนไว้) มันจะสั่ง login ซ้ำทันที
             * กลายเป็นวนเด้งจนหน้าจอกะพริบแล้วไปไหนไม่ได้เลย โดยไม่มี error
             * ให้เห็นสักตัว — จำไว้ใน sessionStorage ว่าลองไปแล้วหนึ่งรอบ
             */
            let alreadyTried = false;
            try {
              alreadyTried = sessionStorage.getItem(LOGIN_ATTEMPT_KEY) === "1";
              sessionStorage.setItem(LOGIN_ATTEMPT_KEY, "1");
            } catch {
              // โหมดส่วนตัวบางเครื่องปิด sessionStorage — ยอมให้ลองครั้งเดียวไปเลย
            }

            if (alreadyTried) {
              setPhase({
                kind: "needs_login",
                reason: "เข้าสู่ระบบผ่าน LINE ไม่สำเร็จ — เข้าด้วยอีเมลแทนได้",
              });
              return;
            }

            liff.login();
            return; // เบราว์เซอร์จะพาออกไปแล้วกลับมาที่หน้านี้เอง
          }
          setPhase({ kind: "needs_login", reason: null });
          return;
        }

        // เข้าได้แล้ว — ล้างธงกันวน เผื่อเซสชันหน้าเริ่มนับใหม่
        try {
          sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);
        } catch {
          // ไม่เป็นไร ธงจะหายเองตอนปิดแท็บอยู่แล้ว
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          // เกือบทุกครั้งคือลืมติ๊ก scope `openid` ใน LINE Developers Console
          setPhase({
            kind: "error",
            message:
              "ขอข้อมูลยืนยันตัวตนจาก LINE ไม่ได้ — แจ้งผู้ดูแลระบบว่า Mini App " +
              "ยังไม่ได้เปิดสิทธิ์ openid",
          });
          return;
        }

        // เตือนเรื่องเพิ่มเพื่อนแบบไม่บล็อกการใช้งาน — ไม่เป็นเพื่อนก็ลงเวลาได้
        // แค่จะไม่ได้รับแจ้งเตือน (push ส่งได้เฉพาะคนที่เพิ่ม OA เป็นเพื่อนแล้ว)
        void liff
          .getFriendship()
          .then((f) => setNotFriend(!f.friendFlag))
          .catch(() => undefined);

        const response = await fetch("/api/auth/line", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });

        if (response.ok) {
          const data = (await response.json()) as { user: { name: string } };
          finishSignedIn(data.user.name);
          return;
        }

        const problem = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
        };
        if (problem.code === "NOT_LINKED") {
          setPhase({ kind: "needs_link", idToken });
          return;
        }
        setPhase({
          kind: "needs_login",
          reason: problem.error ?? "เข้าสู่ระบบผ่าน LINE ไม่สำเร็จ",
        });
      } catch (error) {
        // LIFF พังไม่ใช่จุดจบ — ยังเข้าด้วยอีเมล/รหัสผ่านได้
        setPhase({
          kind: "needs_login",
          reason: error instanceof Error ? error.message : "เปิดผ่าน LINE ไม่สำเร็จ",
        });
      }
    })();
  }, [liffId, lineReady, finishSignedIn]);

  if (phase.kind === "booting") return <Splash />;

  if (phase.kind === "error") {
    return (
      <Centered>
        <p className="text-sm text-(--danger)">{phase.message}</p>
      </Centered>
    );
  }

  if (phase.kind === "needs_link") {
    return <LinkForm idToken={phase.idToken} onDone={finishSignedIn} />;
  }

  if (phase.kind === "needs_login") {
    return <LoginForm reason={phase.reason} onDone={finishSignedIn} />;
  }

  return <Today userName={phase.name} showFriendHint={notFriend} />;
}

function Splash() {
  return (
    <Centered>
      <p className="text-sm text-(--ink-soft)">กำลังเข้าสู่ระบบ…</p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      {children}
    </div>
  );
}

const inputClass =
  "h-12 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-base " +
  "text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden";

/** ปุ่มหลักขนาดนิ้วโป้ง — หน้าจอนี้ใช้กลางแดดบนมือถือ ไม่ใช่บนจอคอม */
const primaryButtonClass =
  "h-12 w-full rounded-(--radius) bg-(--app) text-base font-semibold text-white " +
  "disabled:opacity-60";

function LoginForm({
  reason,
  onDone,
}: {
  reason: string | null;
  onDone: (name: string) => void;
}) {
  return (
    <CredentialForm
      title="เข้าสู่ระบบ"
      hint={reason ?? "กรอกอีเมลและรหัสผ่านของคุณ"}
      submitLabel="เข้าสู่ระบบ"
      endpoint="/api/auth/login"
      extraBody={{}}
      onDone={onDone}
    />
  );
}

function LinkForm({
  idToken,
  onDone,
}: {
  idToken: string;
  onDone: (name: string) => void;
}) {
  return (
    <CredentialForm
      title="ผูกบัญชีครั้งแรก"
      hint={
        "ยืนยันตัวตนด้วยอีเมลและรหัสผ่านของ Smartboss หนึ่งครั้ง " +
        "หลังจากนี้เปิดจาก LINE ได้เลยไม่ต้องกรอกอีก"
      }
      submitLabel="ผูกบัญชี"
      endpoint="/api/auth/line/link"
      extraBody={{ idToken }}
      onDone={onDone}
    />
  );
}

function CredentialForm({
  title,
  hint,
  submitLabel,
  endpoint,
  extraBody,
  onDone,
}: {
  title: string;
  hint: string;
  submitLabel: string;
  endpoint: string;
  extraBody: Record<string, unknown>;
  onDone: (name: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...extraBody, email, password }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        user?: { name: string };
        error?: string;
      };
      if (!response.ok || !data.user) {
        setError(data.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }
      onDone(data.user.name);
    } catch {
      setError("เชื่อมต่อไม่ได้ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-4 p-6 pt-10">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-(--ink-soft)">{hint}</p>
      </div>

      <input
        type="email"
        inputMode="email"
        autoComplete="username"
        placeholder="อีเมล"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={inputClass}
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="รหัสผ่าน"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputClass}
      />

      {error && <p className="text-sm text-(--danger)">{error}</p>}

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "กำลังตรวจสอบ…" : submitLabel}
      </button>
    </form>
  );
}
