"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapBoundary } from "./map-boundary";
import { checkinFlagLabel } from "@/modules/hr/lib/checkin-flags";
import { CLOCK_CHANGED_EVENT, clockState } from "@/modules/hr/lib/clock-state";
import { DesktopQr, useIsDesktop } from "./desktop-qr";
import { recentPosition, rememberPosition } from "./last-position";
/**
 * ต้องโหลดแบบ `ssr: false` เท่านั้น — ห้ามเปลี่ยนเป็น static import เด็ดขาด
 *
 * `checkin-map.tsx` import ไลบรารี leaflet ที่หน้า module อ่านค่า `window`
 * ทันทีตอนโหลดโมดูล (ไม่ใช่ตอนถูกเรียกใช้) ⇒ ต่อให้ตัวคอมโพเนนต์มี "use client"
 * กำกับไว้ Next ก็ยังรันผ่าน server ครั้งแรกเพื่อสร้าง HTML อยู่ดี (route
 * `/m` เป็น dynamic) แล้ว `window is not defined` ทำให้ทั้งหน้าล้มเป็น 500
 * — เจอจริงตอน deploy ขึ้น production ครั้งแรก (ทดสอบตอน build ไม่เจอเพราะ
 * `next build` ไม่ prerender หน้าที่ตั้ง force-dynamic ไว้)
 */
const CheckinMap = dynamic(() => import("./checkin-map").then((m) => m.CheckinMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-56 w-full items-center justify-center rounded-(--radius) border border-(--line) bg-(--bg-soft) text-sm text-(--ink-soft)">
      กำลังโหลดแผนที่…
    </div>
  ),
});

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
  /** กะข้ามคืน: เข้าไว้ตั้งแต่เมื่อวานแล้วยังไม่ออก (ดู /api/m/today) */
  carriedIn?: DayEvent | null;
}

type Submitting = "idle" | "locating" | "sending";

const INTENT_LABEL: Record<string, string> = {
  CLOCK_IN: "เข้างาน",
  CLOCK_OUT: "ออกงาน",
  BREAK_START: "เริ่มพัก",
  BREAK_END: "กลับจากพัก",
  AUTO: "ลงเวลา",
};

// คำอธิบายธงความเสี่ยงอยู่ที่ modules/hr/lib/checkin-flags.ts (ใช้ร่วมกับหน้าคิวตรวจของ HR)

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * หาตำแหน่งแบบมีทางสำรอง — คืน `denied` แยกไว้ เพื่อบอกวิธีเปิดสิทธิ์ (ไม่ใช่ส่งไปแบบไม่มีพิกัดเงียบ ๆ)
 *
 * รอบแรกขอ GPS แม่น ๆ 12 วิ · ในอาคาร/ใต้หลังคา GPS มักหาไม่ทันเวลา ⇒ รอบสองยอมรับตำแหน่งจาก
 * Wi-Fi/เสาสัญญาณ หรือที่เครื่องเพิ่งหาไว้ไม่เกิน 1 นาที (แผนที่บนจอเพิ่งหาไปก่อนกดพอดี)
 * — พิกัดหยาบยังดีกว่าไม่มีเลย ตัวตัดสินฝั่งระบบบุคคลเผื่อความคลาดเคลื่อนให้อยู่แล้ว
 */
async function getPosition(): Promise<{ position: GeolocationPosition | null; denied: boolean }> {
  if (!navigator.geolocation) return { position: null, denied: false };
  // แผนที่บนจอเพิ่งหาตำแหน่งได้ไม่เกิน 1 นาที — ใช้ตัวนั้น ไม่ขอ GPS ซ้ำ (iPhone ถามอนุญาตทุกครั้งที่ขอ)
  const recent = recentPosition();
  if (recent) return { position: recent, denied: false };
  try {
    const position = await readPosition({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
    rememberPosition(position); // แผนที่ที่รอสิทธิ์อยู่วาดตาม (checkin-map.tsx)
    return { position, denied: false };
  } catch (error) {
    if ((error as GeolocationPositionError).code === 1) return { position: null, denied: true };
  }
  try {
    const position = await readPosition({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
    rememberPosition(position);
    return { position, denied: false };
  } catch (error) {
    return { position: null, denied: (error as GeolocationPositionError).code === 1 };
  }
}

/** ข้อความสอนเปิดสิทธิ์ตำแหน่ง — แยก iPhone / Android เพราะเมนูอยู่คนละที่ */
function locationHelp(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง — เปิดที่ การตั้งค่า › ความเป็นส่วนตัวและความปลอดภัย › บริการหาตำแหน่ง › Safari หรือ LINE › ขณะใช้แอป แล้วลองใหม่";
  }
  if (/Android/i.test(ua)) {
    return "ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง — แตะไอคอนแม่กุญแจข้างช่องที่อยู่เว็บ › สิทธิ์ › ตำแหน่ง › อนุญาต (ถ้าใช้ใน LINE: ตั้งค่าเครื่อง › แอป › LINE › สิทธิ์ › ตำแหน่ง) แล้วลองใหม่";
  }
  return "ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง — อนุญาตตำแหน่งให้เว็บนี้ในการตั้งค่าเบราว์เซอร์ แล้วลองใหม่ (แนะนำให้ลงเวลาจากมือถือ)";
}

/**
 * ย่อรูปก่อนส่ง — ระบบบุคคลรับคำขอได้ไม่เกิน 1MB (workforce bootstrap bodyLimit) แต่รูปจากกล้องมือถือ
 * 2–5MB (เป็น base64 ใหญ่ขึ้นอีกหนึ่งในสาม) ⇒ ไม่ย่อ = ลงเวลาแบบบังคับรูปล้มทุกครั้ง
 * ย่อด้านยาวเหลือ 1280px JPEG แล้วลดทีละขั้นจนต่ำกว่า ~600KB (หน้าคนยังชัดพอให้ HR ตรวจ)
 */
const PHOTO_TARGET_BYTES = 600 * 1024;
async function compressPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
      img.src = url;
    });
    const steps = [[1280, 0.8], [1024, 0.7], [800, 0.6], [640, 0.5]] as const;
    let base64 = "";
    for (const [maxSide, quality] of steps) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (base64.length * 0.75 <= PHOTO_TARGET_BYTES) break;
    }
    return base64;
  } finally {
    URL.revokeObjectURL(url);
  }
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
  /**
   * บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงานของ workforce
   *
   * เกิดกับบัญชีผู้ดูแลระบบที่ไม่ได้เป็นพนักงานจริง — กดปุ่มไปก็ล้มทุกครั้ง
   * เพราะฝั่ง workforce ต้องมี employment_id ถึงจะเปิด session ลงเวลาได้
   * ⇒ ปิดปุ่มไปเลยดีกว่าปล่อยให้กดแล้วเจอ error ซ้ำ ๆ โดยไม่รู้ว่าต้องทำอะไร
   */
  const [noEmployment, setNoEmployment] = useState(false);
  const [state, setState] = useState<Submitting>("idle");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(
    null,
  );
  const photoInput = useRef<HTMLInputElement>(null);
  /** เก็บเจตนาไว้ระหว่างที่ผู้ใช้ไปเปิดกล้อง แล้วยิงใหม่ทั้งก้อนตอนได้รูป */
  // state ไม่ใช่ ref — ข้อความบนปุ่ม "ถ่ายรูปเพื่อ…" อ่านค่านี้ตอน render
  const [pendingIntent, setPendingIntent] = useState<"CLOCK_IN" | "CLOCK_OUT">("CLOCK_IN");
  /**
   * บริษัทบังคับรูป — โชว์ปุ่ม "ถ่ายรูป" ให้ผู้ใช้กดเอง แทนสั่งเปิดกล้องจากโค้ด
   * iPhone (Safari/LINE) ยอมเปิดกล้องเฉพาะเมื่อมาจากการแตะของผู้ใช้โดยตรง — เดิมสั่ง `.click()`
   * หลังรอเซิร์ฟเวอร์ตอบ ซึ่ง iOS ไม่นับว่าเป็นการแตะแล้ว กล้องไม่เปิด ลงเวลาไม่ได้เลย
   */
  const [needsPhoto, setNeedsPhoto] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/m/today", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as TodayData & {
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setNoEmployment(payload.code === "NO_EMPLOYMENT");
        setLoadError(payload.error ?? "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      setData(payload);
      setLoadError(null);
      setNoEmployment(false);
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

      // ไม่ได้พิกัดก็ยังส่งไป — เซิร์ฟเวอร์เป็นคนตัดสิน (api/m/checkin gpsGate: ไม่มีพิกัด/นอกเขต = ลงไม่ได้
      // พร้อมเหตุผล) หน้าจอไม่ตัดสินเอง · ถ้าโดนปฏิเสธสิทธิ์ตำแหน่ง ต่อท้ายข้อความด้วยวิธีเปิด
      const { position, denied } = await getPosition();
      const help = denied ? ` — ${locationHelp()}` : "";

      setState("sending");
      try {
        const body: Record<string, unknown> = {
          intent,
          latitude: position?.coords.latitude ?? null,
          longitude: position?.coords.longitude ?? null,
          accuracyM: position?.coords.accuracy ?? null,
        };
        if (photo) {
          try {
            body.photoBase64 = await compressPhoto(photo);
            body.photoContentType = "image/jpeg";
          } catch {
            setMessage({ tone: "bad", text: "อ่านรูปไม่สำเร็จ ลองถ่ายใหม่อีกครั้ง" });
            return;
          }
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
          setPendingIntent(intent);
          setNeedsPhoto(true);
          setMessage({ tone: "warn", text: "บริษัทกำหนดให้ถ่ายรูปตอนลงเวลา — กดปุ่ม \"ถ่ายรูป\" ด้านบน" });
          return;
        }
        setNeedsPhoto(false);

        if (!response.ok) {
          setMessage({ tone: "bad", text: (payload.error ?? "ลงเวลาไม่สำเร็จ") + help });
          return;
        }

        const flags = (payload.riskFlags ?? []).map((f) => checkinFlagLabel(f));
        const distance =
          typeof payload.distanceM === "number"
            ? ` (ห่างจากจุดที่ตั้งไว้ ${Math.round(payload.distanceM)} ม.)`
            : "";

        // แถบล่าง (ปุ่มลงเวลาตรงกลาง) อยู่บนจอเดียวกัน — บอกให้อ่านสถานะใหม่
        window.dispatchEvent(new Event(CLOCK_CHANGED_EVENT));

        // มีข้อสังเกตก็นับเวลาแล้ว (HR ไปถามเองถ้าแปลก ดูหน้า "ลงเวลาผิดปกติ") — พนักงานเห็นว่าบันทึกสำเร็จ
        if (payload.decision === "ACCEPTED" || payload.decision === "ACCEPTED_WITH_WARNING") {
          setMessage({ tone: "ok", text: `บันทึก${INTENT_LABEL[intent]}เรียบร้อย${help}` });
        } else if (payload.decision === "PENDING_REVIEW") {
          setMessage({
            tone: "warn",
            text: `บันทึกแล้ว รอฝ่ายบุคคลตรวจสอบ: ${flags.join(" · ")}${distance}${help}`,
          });
        } else {
          setMessage({
            tone: "bad",
            text: `ลงเวลาไม่ผ่าน: ${flags.join(" · ")}${distance}${help}`,
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
  // นับสแกนนิ้ว (AUTO) และกะข้ามคืนด้วย — ดู modules/hr/lib/clock-state.ts
  // เวลาเข้า/ออกที่โชว์ตัวใหญ่ = เข้าครั้งแรก / ออกครั้งล่าสุด (ทุกครั้งอยู่ในรายการด้านล่าง)
  const { open, firstIn, lastOut } = clockState(events, data?.carriedIn ?? null);
  const nextIntent: "CLOCK_IN" | "CLOCK_OUT" = open ? "CLOCK_OUT" : "CLOCK_IN";
  const busy = state !== "idle" || noEmployment;
  const isDesktop = useIsDesktop();

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

      {/* คอมพิวเตอร์: QR ไปลงเวลาบนมือถือแทนแผนที่ + ปุ่ม (คอมไม่มี GPS ลงไม่ผ่านอยู่แล้ว)
          ยังไม่รู้ว่าเครื่องอะไร (null) = ยังไม่โชว์ทั้งสองแบบ กันกระพริบ */}
      {isDesktop && <DesktopQr />}

      {/* ดูก่อนกดว่าอยู่ในระยะไหม — ไม่ได้บังคับ แค่ให้เห็นก่อนเสียเวลากดแล้วไม่ผ่าน
          ครอบด้วย boundary เพราะแผนที่พังต้องไม่ลากปุ่มลงเวลาตายไปด้วย */}
      {isDesktop === false && (
        <MapBoundary>
          <CheckinMap />
        </MapBoundary>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "เข้างาน", event: firstIn },
          { label: "ออกงาน", event: lastOut },
        ].map(({ label, event }) => (
          <div key={label} className="rounded-2xl border border-(--line) bg-(--bg-soft) p-3 text-center">
            <p className="text-xs text-(--ink-soft)">{label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{event ? timeOf(event.capturedAt) : "--:--"}</p>
            {event && event === data?.carriedIn && <p className="mt-0.5 text-xs text-(--ink-soft)">เมื่อวาน</p>}
            {event && event.lateMinutes > 0 && (
              <p className="mt-0.5 text-xs text-(--tone-warn)">สาย {event.lateMinutes} นาที</p>
            )}
          </div>
        ))}
      </div>

      {isDesktop !== false ? null : needsPhoto && state === "idle" ? (
        // แตะปุ่มนี้ = เปิดกล้องจากการแตะโดยตรง (iPhone ยอม) แล้วส่งรูปพร้อมลงเวลาทั้งก้อน
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => photoInput.current?.click()}
            className="h-32 w-full rounded-2xl bg-(--app) text-2xl font-bold text-white"
          >
            📷 ถ่ายรูปเพื่อ{INTENT_LABEL[pendingIntent]}
          </button>
          <button
            type="button"
            onClick={() => {
              setNeedsPhoto(false);
              setMessage(null);
            }}
            className="text-sm text-(--ink-soft) underline"
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(nextIntent)}
          className="h-32 w-full rounded-2xl bg-(--app) text-2xl font-bold text-white disabled:opacity-60"
        >
          {noEmployment
            ? "ยังลงเวลาไม่ได้"
            : state === "locating"
              ? "กำลังหาตำแหน่ง…"
              : state === "sending"
                ? "กำลังบันทึก…"
                : INTENT_LABEL[nextIntent]}
        </button>
      )}

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
          if (file) void submit(pendingIntent, file);
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

      {loadError && (
        <p
          className={`rounded-(--radius) p-3 text-sm ${
            noEmployment ? "bg-(--bg-soft) text-(--tone-warn)" : "text-(--danger)"
          }`}
        >
          {loadError}
        </p>
      )}

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
