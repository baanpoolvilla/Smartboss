"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * หน้า "วันนี้" — จอเดียวที่พนักงานหน้างานเปิดบ่อยที่สุด
 *
 * ออกแบบให้กดได้ด้วยนิ้วโป้งข้างเดียวกลางแดด: ปุ่มเดียวเต็มความกว้าง
 * ตัวหนังสือใหญ่ ไม่มีเมนู ไม่มีอะไรให้เลือกผิด
 */

interface DayEvent {
  id: string;
  capturedAt: string;
  intent: string;
  sourceType: string;
  lateMinutes: number;
}

interface TodayData {
  date: string;
  displayName: string;
  events: DayEvent[];
}

type Submitting = "idle" | "locating" | "sending";

const INTENT_LABEL: Record<string, string> = {
  CLOCK_IN: "เข้างาน",
  CLOCK_OUT: "ออกงาน",
  BREAK_START: "เริ่มพัก",
  BREAK_END: "กลับจากพัก",
  AUTO: "ลงเวลา",
};

/** แปลงธงความเสี่ยงเป็นภาษาที่พนักงานอ่านแล้วรู้ว่าต้องทำอะไรต่อ */
const RISK_LABEL: Record<string, string> = {
  LOCATION_MISSING: "ไม่ได้ส่งตำแหน่งมาด้วย",
  LOCATION_ACCURACY_POOR: "สัญญาณตำแหน่งไม่แม่นพอ ลองออกไปที่โล่งแล้วลองใหม่",
  GEOFENCE_OUTSIDE: "อยู่นอกบริเวณสถานที่ทำงาน",
  NO_SITE_MATCHED: "ไม่พบสถานที่ทำงานใกล้เคียง",
  MOCK_LOCATION: "ตรวจพบการปลอมตำแหน่ง",
  DEVICE_NOT_ENROLLED: "เครื่องนี้ยังไม่ได้รับอนุมัติ",
  PHOTO_MISSING: "ไม่มีรูปประกอบ",
  NOT_LIVE_CAPTURE: "รูปไม่ได้ถ่ายสด",
  CLOCK_SKEW: "เวลาในเครื่องคลาดจากเวลาจริง",
};

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("เครื่องนี้ไม่รองรับการระบุตำแหน่ง"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    });
  });
}

/** อ่านไฟล์รูปเป็น base64 ล้วน (ตัดส่วนหัว data: ออก เพราะ API รับเฉพาะตัวข้อมูล) */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

export function Today({
  userName,
  showFriendHint,
}: {
  userName: string;
  showFriendHint: boolean;
}) {
  const [data, setData] = useState<TodayData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<Submitting>("idle");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(
    null,
  );
  const photoInput = useRef<HTMLInputElement>(null);
  /** เก็บเจตนาไว้ระหว่างที่ผู้ใช้ไปเปิดกล้อง แล้วยิงใหม่ทั้งก้อนตอนได้รูป */
  const pendingIntent = useRef<"CLOCK_IN" | "CLOCK_OUT">("CLOCK_IN");

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/m/today", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as TodayData & {
        error?: string;
      };
      if (!response.ok) {
        setLoadError(payload.error ?? "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      setData(payload);
      setLoadError(null);
    } catch {
      setLoadError("เชื่อมต่อไม่ได้ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = useCallback(
    async (intent: "CLOCK_IN" | "CLOCK_OUT", photo?: File) => {
      setMessage(null);
      setState("locating");

      let position: GeolocationPosition | null = null;
      try {
        position = await getPosition();
      } catch {
        // ไม่ได้พิกัดก็ยังส่งไป — ให้ *นโยบายของบริษัท* เป็นคนตัดสินว่ารับหรือไม่รับ
        // ไม่ใช่ให้หน้าจอตัดสินแทน (บางบริษัทไม่ได้บังคับพิกัด)
        position = null;
      }

      setState("sending");
      try {
        const body: Record<string, unknown> = {
          intent,
          latitude: position?.coords.latitude ?? null,
          longitude: position?.coords.longitude ?? null,
          accuracyM: position?.coords.accuracy ?? null,
        };
        if (photo) {
          body.photoBase64 = await toBase64(photo);
          body.photoContentType = photo.type === "image/png" ? "image/png" : "image/jpeg";
        }

        const response = await fetch("/api/m/checkin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
          decision?: string;
          riskFlags?: string[];
          distanceM?: number | null;
        };

        if (payload.code === "PHOTO_REQUIRED") {
          pendingIntent.current = intent;
          setState("idle");
          setMessage({ tone: "warn", text: "บริษัทกำหนดให้ถ่ายรูปตอนลงเวลา — เปิดกล้อง…" });
          photoInput.current?.click();
          return;
        }

        if (!response.ok) {
          setMessage({ tone: "bad", text: payload.error ?? "ลงเวลาไม่สำเร็จ" });
          return;
        }

        const flags = (payload.riskFlags ?? []).map((f) => RISK_LABEL[f] ?? f);
        const distance =
          typeof payload.distanceM === "number"
            ? ` (ห่างจากจุดที่ตั้งไว้ ${Math.round(payload.distanceM)} ม.)`
            : "";

        if (payload.decision === "ACCEPTED") {
          setMessage({ tone: "ok", text: `บันทึก${INTENT_LABEL[intent]}เรียบร้อย` });
        } else if (payload.decision === "ACCEPTED_WITH_WARNING") {
          setMessage({
            tone: "warn",
            text: `บันทึกแล้ว แต่มีข้อสังเกต: ${flags.join(" · ")}${distance}`,
          });
        } else if (payload.decision === "PENDING_REVIEW") {
          setMessage({
            tone: "warn",
            text: `บันทึกแล้ว รอฝ่ายบุคคลตรวจสอบ: ${flags.join(" · ")}${distance}`,
          });
        } else {
          setMessage({
            tone: "bad",
            text: `ลงเวลาไม่ผ่าน: ${flags.join(" · ")}${distance}`,
          });
        }

        await reload();
      } catch {
        setMessage({ tone: "bad", text: "ส่งข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" });
      } finally {
        setState("idle");
      }
    },
    [reload],
  );

  const events = data?.events ?? [];
  // เข้าแล้วยังไม่ออก = ปุ่มถัดไปควรเป็น "ออกงาน" — เดาให้ถูกตั้งแต่แรก
  // ดีกว่าให้พนักงานต้องเลือกเองทุกครั้งแล้วมีโอกาสกดผิด
  const lastIntent = events.length > 0 ? events[events.length - 1]!.intent : null;
  const nextIntent: "CLOCK_IN" | "CLOCK_OUT" =
    lastIntent === "CLOCK_IN" ? "CLOCK_OUT" : "CLOCK_IN";
  const busy = state !== "idle";

  return (
    <div className="flex flex-1 flex-col gap-5 p-5 pt-8">
      <div>
        <p className="text-sm text-(--ink-soft)">สวัสดี</p>
        <h1 className="text-xl font-bold">{data?.displayName ?? userName}</h1>
      </div>

      {showFriendHint && (
        <p className="rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">
          เพิ่ม SmartBoss เป็นเพื่อนใน LINE เพื่อรับแจ้งเตือน — ตอนนี้ยังใช้งานได้ตามปกติ
          แต่จะไม่ได้รับข้อความแจ้งเตือน
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void submit(nextIntent)}
        className="h-32 w-full rounded-2xl bg-(--app) text-2xl font-bold text-white disabled:opacity-60"
      >
        {state === "locating"
          ? "กำลังหาตำแหน่ง…"
          : state === "sending"
            ? "กำลังบันทึก…"
            : INTENT_LABEL[nextIntent]}
      </button>

      {/* กล้องเปิดเมื่อ *นโยบายบริษัท* สั่งเท่านั้น ไม่ได้ขอรูปทุกครั้ง */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void submit(pendingIntent.current, file);
        }}
      />

      {message && (
        <p
          className="rounded-(--radius) p-3 text-sm"
          style={{
            color:
              message.tone === "ok"
                ? "var(--tone-ok)"
                : message.tone === "warn"
                  ? "var(--tone-warn)"
                  : "var(--danger)",
            backgroundColor: "var(--bg-soft)",
          }}
        >
          {message.text}
        </p>
      )}

      {loadError && <p className="text-sm text-(--danger)">{loadError}</p>}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-(--ink-soft)">การลงเวลาวันนี้</h2>
        {events.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">ยังไม่มีการลงเวลา</p>
        ) : (
          <ul className="divide-y divide-(--line) rounded-(--radius) border border-(--line)">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between p-3">
                <span className="text-sm">{INTENT_LABEL[event.intent] ?? event.intent}</span>
                <span className="flex items-center gap-2">
                  {event.lateMinutes > 0 && (
                    <span className="text-xs text-(--tone-warn)">
                      สาย {event.lateMinutes} นาที
                    </span>
                  )}
                  <span className="text-base font-semibold tabular-nums">
                    {timeOf(event.capturedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
