"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import L from "leaflet";

/**
 * แผนที่ที่มาของการลงเวลาหนึ่งครั้ง — จุดที่มือถือกดลงเวลา + วงรัศมีจุดเช็คอิน
 *
 * ⚠ ต้องโหลดผ่าน next/dynamic แบบ ssr: false เท่านั้น — leaflet อ่าน `window`
 * ตอนโหลดโมดูล (เหตุผลเต็มอยู่ที่ app/m/today.tsx)
 */

// สีตรงกับ --app / --tone-* ใน packages/ui/tokens.css — Leaflet วาด SVG เอง ไม่ผ่าน CSS variable
const COLOR_APP = "#3B82F6";
const COLOR_SITE = "#16a34a";

function dotIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${COLOR_APP};border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<svg viewBox="0 0 24 24" width="26" height="26" style="transform:translateY(-4px)">
      <path fill="${COLOR_SITE}" stroke="white" stroke-width="1.5"
        d="M12 2c-4.4 0-8 3.5-8 8 0 5.8 8 12 8 12s8-6.2 8-12c0-4.5-3.6-8-8-8z"/>
      <circle cx="12" cy="10" r="3" fill="white"/>
    </svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

export function OriginMap({
  scan,
  site,
}: {
  scan: { latitude: number; longitude: number; accuracyM: number | null } | null;
  site: { name: string; latitude: number; longitude: number; radiusM: number | null } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const center = scan ?? site;
    if (!center) return;

    // center+zoom ตั้งแต่ตอนสร้าง — สร้างเปล่าแล้ว getBounds() จะพัง (ดู app/m/checkin-map.tsx)
    const map = L.map(ref.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      center: [center.latitude, center.longitude],
      zoom: 17,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([[center.latitude, center.longitude]]);

    if (site) {
      if (site.radiusM) {
        const circle = L.circle([site.latitude, site.longitude], {
          radius: site.radiusM,
          color: COLOR_SITE,
          weight: 2,
          fillOpacity: 0.1,
        }).addTo(map);
        bounds.extend(circle.getBounds());
      }
      L.marker([site.latitude, site.longitude], { icon: pinIcon() })
        .addTo(map)
        .bindTooltip(site.name, { direction: "top", offset: [0, -24] });
      bounds.extend([site.latitude, site.longitude]);
    }

    if (scan) {
      if (scan.accuracyM) {
        L.circle([scan.latitude, scan.longitude], {
          radius: scan.accuracyM,
          color: COLOR_APP,
          weight: 1,
          fillOpacity: 0.08,
          dashArray: "4 4",
        }).addTo(map);
      }
      L.marker([scan.latitude, scan.longitude], { icon: dotIcon(), zIndexOffset: 1000 })
        .addTo(map)
        .bindTooltip("จุดที่กดลงเวลา", { direction: "top", offset: [0, -10] });
      bounds.extend([scan.latitude, scan.longitude]);
    }

    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
    return () => {
      map.remove();
    };
  }, [scan, site]);

  // isolate = เก็บ z-index ของ Leaflet ไว้ในกล่อง ไม่ให้ลอยทับ Modal/เมนูอื่น
  return <div ref={ref} className="isolate h-56 w-full overflow-hidden rounded-(--radius) border border-(--line)" />;
}
