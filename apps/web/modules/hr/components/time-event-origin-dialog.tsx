"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Modal } from "@/components/module/dialog";
import { Icon } from "@/components/icon";
import { checkinFlagLabel } from "../lib/checkin-flags";
import { eventIntentLabel, eventSourceIcon, eventSourceLabel, formatTime } from "../lib/labels";
import type { TimeEvent, TimeEventOrigin } from "../lib/api";

// ssr: false เท่านั้น — leaflet อ่าน window ตอนโหลดโมดูล (ดู app/m/today.tsx)
const OriginMap = dynamic(() => import("./origin-map").then((m) => m.OriginMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-56 w-full items-center justify-center rounded-(--radius) border border-(--line) bg-(--bg-soft) text-sm text-(--ink-soft)">
      กำลังโหลดแผนที่…
    </div>
  ),
});

export type LoadOrigin = (eventId: string) => Promise<{ origin?: TimeEventOrigin; error?: string }>;
export type LoadPhotoUrl = (evidenceId: string) => Promise<{ url?: string; error?: string }>;

function metersLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} กม.` : `${Math.round(m)} ม.`;
}

/**
 * "สแกนจากไหน" — กดไอคอนช่องทางท้ายแถวรายชื่อวันนี้แล้วเปิดกล่องนี้
 *
 * แสดงทุกครั้งที่คนนี้ลงเวลาในวันนั้น (คนหนึ่งตอกหลายครั้ง แต่ละครั้งอาจคนละที่/คนละช่องทาง)
 * เปิดมาเลือกครั้งล่าสุดไว้ให้ = ครั้งเดียวกับไอคอนที่กด · รายละเอียดดึงทีละครั้งเมื่อเลือก
 * เพราะทุกครั้งที่ดึงถูกบันทึก audit ฝั่ง workforce — ไม่ควรดึงล่วงหน้าทั้งหมดโดยที่ไม่มีใครดู
 */
export function TimeEventOriginDialog({
  name,
  events,
  loadOrigin,
  loadPhotoUrl,
  onClose,
}: {
  name: string;
  events: TimeEvent[];
  loadOrigin: LoadOrigin;
  loadPhotoUrl: LoadPhotoUrl;
  onClose: () => void;
}) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => a.captured_at.localeCompare(b.captured_at)),
    [events],
  );
  const [selectedId, setSelectedId] = useState<string | null>(sorted.at(-1)?.id ?? null);
  const [cache, setCache] = useState<Record<string, { origin?: TimeEventOrigin; error?: string }>>({});

  useEffect(() => {
    if (selectedId === null || cache[selectedId]) return;
    let cancelled = false;
    loadOrigin(selectedId)
      .catch(() => ({ error: "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" }))
      .then((res) => {
        if (!cancelled) setCache((prev) => ({ ...prev, [selectedId]: res }));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, cache, loadOrigin]);

  const current = selectedId === null ? undefined : cache[selectedId];

  return (
    <Modal title={`สแกนจากไหน · ${name}`} onClose={onClose} wide>
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-(--ink-soft)">ไม่พบรายการลงเวลาของวันนี้</p>
      ) : (
        <div className="flex flex-col gap-4">
          {sorted.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {sorted.map((ev) => {
                const on = ev.id === selectedId;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setSelectedId(ev.id)}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                      on
                        ? "border-(--app) bg-(--app)/10 font-medium text-(--ink)"
                        : "border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)"
                    }`}
                  >
                    <Icon name={eventSourceIcon(ev.source_type)} className="h-3.5 w-3.5" />
                    <span className="font-mono tabular-nums">{formatTime(ev.captured_at)}</span>
                    <span>{eventIntentLabel(ev.event_intent)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {current === undefined ? (
            <p className="py-6 text-center text-sm text-(--ink-soft)">กำลังโหลด…</p>
          ) : current.error || !current.origin ? (
            <p className="rounded-(--radius) bg-(--bg-soft) p-4 text-center text-sm text-(--ink-soft)">
              {current.error ?? "ไม่พบข้อมูล"}
            </p>
          ) : (
            <OriginDetail origin={current.origin} loadPhotoUrl={loadPhotoUrl} />
          )}
        </div>
      )}
    </Modal>
  );
}

function OriginDetail({ origin, loadPhotoUrl }: { origin: TimeEventOrigin; loadPhotoUrl: LoadPhotoUrl }) {
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // อ้างอิงคงที่ต่อ origin หนึ่งตัว — OriginMap วาดแผนที่ใหม่ทุกครั้งที่ prop เปลี่ยนอ้างอิง
  const scan = useMemo(
    () =>
      origin.location === null
        ? null
        : {
            latitude: origin.location.latitude,
            longitude: origin.location.longitude,
            accuracyM: origin.location.accuracy_m,
          },
    [origin],
  );
  const site = useMemo(
    () =>
      origin.site === null || origin.site.latitude === null || origin.site.longitude === null
        ? null
        : {
            name: origin.site.name,
            latitude: origin.site.latitude,
            longitude: origin.site.longitude,
            radiusM: origin.site.radius_m,
          },
    [origin],
  );

  async function openPhoto() {
    if (!origin.photo_evidence_id) return;
    // เปิดแท็บก่อน await — เบราว์เซอร์บล็อก window.open ที่ไม่ได้เกิดตรงจากการกด
    const tab = window.open("", "_blank");
    setPhotoBusy(true);
    setPhotoError(null);
    const res = await loadPhotoUrl(origin.photo_evidence_id).catch(() => ({ error: "เปิดรูปไม่สำเร็จ" }));
    setPhotoBusy(false);
    if ("url" in res && res.url) {
      if (tab) tab.location.href = res.url;
      else window.location.href = res.url;
    } else {
      tab?.close();
      setPhotoError(res.error ?? "เปิดรูปไม่สำเร็จ");
    }
  }

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: "ช่องทาง",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <Icon name={eventSourceIcon(origin.source_type)} className="h-4 w-4" />
          {eventSourceLabel(origin.source_type)}
        </span>
      ),
    },
    { label: "เวลา", value: `${formatTime(origin.captured_at)} · ${eventIntentLabel(origin.event_intent)}` },
  ];
  if (origin.device) {
    rows.push({ label: "เครื่องสแกน", value: `${origin.device.name || "ไม่มีชื่อ"} (${origin.device.device_code})` });
  }
  if (origin.site) {
    rows.push({
      label: origin.source_type === "FINGERPRINT_DEVICE" ? "ติดตั้งที่" : "จุดเช็คอิน",
      value: origin.site.name,
    });
  } else if (origin.source_type === "MOBILE_APP") {
    rows.push({ label: "จุดเช็คอิน", value: "ไม่ตรงกับจุดเช็คอินใด" });
  }
  if (origin.distance_from_site_m !== null) {
    rows.push({ label: "ห่างจากจุดเช็คอิน", value: metersLabel(origin.distance_from_site_m) });
  }
  if (origin.location) {
    rows.push({
      label: "พิกัด",
      value: (
        <a
          href={`https://www.google.com/maps?q=${origin.location.latitude},${origin.location.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-(--app-strong,var(--ink)) hover:underline"
        >
          {origin.location.latitude.toFixed(6)}, {origin.location.longitude.toFixed(6)} ↗
        </a>
      ),
    });
    if (origin.location.accuracy_m !== null) {
      rows.push({ label: "ความแม่น GPS", value: `±${Math.round(origin.location.accuracy_m)} ม.` });
    }
  }
  if (origin.platform || origin.app_version) {
    rows.push({ label: "อุปกรณ์", value: [origin.platform, origin.app_version].filter(Boolean).join(" · ") });
  }

  const noLocationNote =
    origin.source_type === "MOBILE_APP" && origin.location === null
      ? "ครั้งนี้ไม่ได้แนบพิกัดมาด้วย"
      : origin.source_type === "MANUAL" || origin.source_type === "IMPORT"
        ? "บันทึกโดยเจ้าหน้าที่/นำเข้าไฟล์ — ไม่มีพิกัด"
        : origin.source_type === "FINGERPRINT_DEVICE" && site === null
          ? "เครื่องนี้ยังไม่ได้ผูกกับสถานที่ที่มีพิกัด — ตั้งได้ที่หน้าตั้งค่าเครื่องสแกน"
          : null;

  return (
    <div className="flex flex-col gap-4">
      {(scan || site) && <OriginMap scan={scan} site={site} />}
      {noLocationNote && (
        <p className="rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">{noLocationNote}</p>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-(--ink-soft)">{r.label}</dt>
            <dd className="min-w-0 break-words text-(--ink)">{r.value}</dd>
          </div>
        ))}
      </dl>

      {origin.risk_flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {origin.risk_flags.map((f) => (
            <span
              key={f}
              className="rounded-full px-2 py-px text-[11px] font-medium"
              style={{
                color: "var(--tone-warn)",
                backgroundColor: "color-mix(in srgb, var(--tone-warn) 14%, transparent)",
              }}
            >
              {checkinFlagLabel(f)}
            </span>
          ))}
        </div>
      )}

      {origin.photo_evidence_id && (
        <div>
          <button
            type="button"
            onClick={openPhoto}
            disabled={photoBusy}
            className="text-xs font-medium text-(--app-strong,var(--ink)) hover:underline disabled:opacity-50"
          >
            {photoBusy ? "กำลังเปิด…" : "ดูรูปที่ถ่ายตอนลงเวลา ↗"}
          </button>
          {photoError && <p className="mt-1 text-xs text-(--tone-danger)">{photoError}</p>}
        </div>
      )}
    </div>
  );
}
