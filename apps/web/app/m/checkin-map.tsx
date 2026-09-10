"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { LocateFixed, MapPinOff, RefreshCw } from "lucide-react";

/**
 * แผนที่ตัวเอง vs วงรัศมีที่เช็คอินได้ — โชว์ก่อนกดปุ่มลงเวลาจริง
 *
 * ทำไมต้องดึงข้อมูลเอง แยกจาก `Today`: หน้านี้ต้องใช้ทั้งตำแหน่งตัวเอง (ขอสิทธิ์
 * เบราว์เซอร์) และรายชื่อสถานที่ (ยิง API) ซึ่งเป็นสองอย่างที่ไม่เกี่ยวกับ
 * "วันนี้ลงเวลาไปกี่ครั้ง" เลย — แยกกันจะพังแยกกัน ไม่ลากกันตายทั้งคู่
 *
 * ตั้งใจ**ไม่ใช้ watchPosition** (ติดตามตำแหน่งต่อเนื่อง) — พนักงานยืนดูจอ
 * ไม่ได้เดินไปมาระหว่างดูแผนที่ ขอครั้งเดียวพอ มีปุ่มรีเฟรชให้กดเองถ้าขยับที่
 * ประหยัดแบตกว่าปล่อย GPS ทำงานตลอดเวลาที่หน้านี้เปิดอยู่
 */

interface CheckinSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
}

interface SitesResponse {
  location_required: boolean;
  sites: CheckinSite[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "no_sites" }
  | { kind: "denied" }
  | { kind: "error"; message: string }
  | { kind: "ready"; sites: CheckinSite[]; me: GeolocationCoordinates };

// สีตรงกับ --app / --tone-* ของโมดูล hr ใน packages/ui/tokens.css — คัดลอกเป็น
// ค่าคงที่เพราะ Leaflet วาด SVG เอง ไม่ผ่าน Tailwind/CSS variable ของหน้า
const COLOR_APP = "#3B82F6";
const COLOR_OK = "#16a34a";
const COLOR_WARN = "#ea580c";

function metersLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} กม.` : `${Math.round(m)} ม.`;
}

/** จุด "ฉันอยู่นี่" — วงกลมทึบสีฟ้าล้อมด้วยขอบขาวและรัศมีจางซ้อน ไม่ใช้ไอคอนรูปภาพ */
function meIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="position:relative;display:block;width:18px;height:18px">
      <span style="position:absolute;inset:-10px;border-radius:9999px;background:${COLOR_APP}33"></span>
      <span style="position:absolute;inset:0;border-radius:9999px;background:${COLOR_APP};border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>
    </span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** หมุดสถานที่ — ทรงหยดน้ำเรียบ ๆ สีเดียวกับวงรัศมีของสถานที่นั้น */
function siteIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:26px;height:26px;transform:translateY(-4px)">
      <svg viewBox="0 0 24 24" width="26" height="26">
        <path fill="${color}" stroke="white" stroke-width="1.5"
          d="M12 2c-4.4 0-8 3.5-8 8 0 5.8 8 12 8 12s8-6.2 8-12c0-4.5-3.6-8-8-8z"/>
        <circle cx="12" cy="10" r="3" fill="white"/>
      </svg>
    </span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

export function CheckinMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let sites: CheckinSite[];
      try {
        const response = await fetch("/api/m/checkin-sites", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as SitesResponse;
        sites = data.sites;
      } catch {
        if (!cancelled) setState({ kind: "error", message: "โหลดข้อมูลสถานที่ไม่สำเร็จ" });
        return;
      }

      if (sites.length === 0) {
        if (!cancelled) setState({ kind: "no_sites" });
        return;
      }

      if (!navigator.geolocation) {
        if (!cancelled) setState({ kind: "error", message: "เครื่องนี้ไม่รองรับการระบุตำแหน่ง" });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!cancelled) setState({ kind: "ready", sites, me: position.coords });
        },
        (error) => {
          if (cancelled) return;
          setState(
            error.code === error.PERMISSION_DENIED
              ? { kind: "denied" }
              : { kind: "error", message: "หาตำแหน่งไม่สำเร็จ ลองใหม่อีกครั้ง" },
          );
        },
        { enableHighAccuracy: true, timeout: 15_000 },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // วาดแผนที่จริงเมื่อมีทั้งพิกัดตัวเองและรายชื่อสถานที่แล้วเท่านั้น
  useEffect(() => {
    if (state.kind !== "ready" || !containerRef.current) return;

    const me = L.latLng(state.me.latitude, state.me.longitude);

    /*
     * ⚠ ต้องมี center+zoom ตั้งแต่ตอนสร้าง — ห้ามสร้างแผนที่เปล่าแล้วค่อย fitBounds
     *
     * Leaflet ไม่ผูก layer เข้ากับแผนที่จริง ๆ จนกว่าแผนที่จะ "พร้อม" (มีจุดกึ่งกลาง
     * กับระดับซูมแล้ว) — `addTo(map)` แค่เข้าคิวรอไว้เฉย ๆ ⇒ `circle._map` ยังเป็น
     * undefined อยู่ พอเรียก `circle.getBounds()` ต่อทันทีจึงพังด้วย
     * "undefined is not an object (evaluating 'this._map.layerPointToLatLng')"
     *
     * บนคอมไม่เจอเพราะบัญชีที่ทดสอบไม่มีข้อมูลพนักงาน ⇒ ไม่มีสถานที่ให้วาดวงเลย
     * โค้ดท่อนที่พังจึงไม่เคยถูกรันจนกระทั่งเปิดบนมือถือด้วยบัญชีพนักงานจริง
     */
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
      center: me,
      zoom: 16,
    });
    mapRef.current = map;

    // CARTO Positron — โทนเทาอ่อนเรียบ ไม่มีสี ไม่มีป้ายรก ให้หมุด/วงรัศมีของเรา
    // เป็นจุดเด่นแทน (ฟรี ไม่ต้องมี API key เหมาะกับปริมาณเรียกระดับนี้)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([me]);

    L.marker(me, { icon: meIcon(), zIndexOffset: 1000 }).addTo(map);
    // วงบอกความแม่นของ GPS เอง — โปร่งกว่าวงรัศมีสถานที่ชัดเจน กันสับสนว่าเป็นวงเดียวกัน
    L.circle(me, {
      radius: state.me.accuracy,
      color: COLOR_APP,
      weight: 1,
      fillOpacity: 0.08,
      dashArray: "4 4",
    }).addTo(map);

    for (const site of state.sites) {
      const distance = map.distance(me, [site.latitude, site.longitude]);
      const inRange = distance <= site.radius_m;
      const color = inRange ? COLOR_OK : COLOR_WARN;

      const circle = L.circle([site.latitude, site.longitude], {
        radius: site.radius_m,
        color,
        weight: 2,
        fillOpacity: 0.12,
      }).addTo(map);
      bounds.extend(circle.getBounds());

      L.marker([site.latitude, site.longitude], { icon: siteIcon(color) })
        .addTo(map)
        .bindTooltip(`${site.name} · ${metersLabel(distance)}`, {
          direction: "top",
          offset: [0, -24],
          className: "checkin-map-tooltip",
        });
    }

    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [state]);

  const nearest =
    state.kind === "ready"
      ? state.sites
          .map((site) => ({
            site,
            distance: haversine(state.me.latitude, state.me.longitude, site.latitude, site.longitude),
          }))
          .sort((a, b) => a.distance - b.distance)[0]
      : undefined;

  return (
    <div className="overflow-hidden rounded-(--radius) border border-(--line)">
      <div className="relative h-56 w-full bg-(--bg-soft)">
        {state.kind === "ready" && <div ref={containerRef} className="h-full w-full" />}

        {state.kind === "loading" && (
          <div className="flex h-full items-center justify-center text-sm text-(--ink-soft)">
            กำลังหาตำแหน่ง…
          </div>
        )}

        {state.kind === "no_sites" && (
          <MapMessage icon={<MapPinOff className="h-6 w-6" />}>
            บริษัทยังไม่ได้ตั้งสถานที่ทำงานไว้ — แจ้งฝ่ายบุคคลให้ตั้งค่าก่อน
          </MapMessage>
        )}

        {state.kind === "denied" && (
          <MapMessage icon={<MapPinOff className="h-6 w-6" />}>
            เบราว์เซอร์ปฏิเสธการขอตำแหน่ง — กดอนุญาตแล้วรีเฟรชอีกครั้ง
          </MapMessage>
        )}

        {state.kind === "error" && <MapMessage icon={<MapPinOff className="h-6 w-6" />}>{state.message}</MapMessage>}

        <button
          type="button"
          onClick={() => {
            // ตั้งเป็น loading เองในตัว handler (ไม่ใช่ใน effect) — ป้องกัน
            // cascading render ตามกฎ react-hooks/set-state-in-effect
            setState({ kind: "loading" });
            setRefreshKey((k) => k + 1);
          }}
          aria-label="รีเฟรชตำแหน่ง"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-(--bg)/90 text-(--ink) shadow-(--shadow-card) backdrop-blur"
        >
          <RefreshCw className={`h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />
        </button>
      </div>

      {nearest && (
        <div
          className="flex items-center gap-2 px-3 py-2 text-sm"
          style={{ color: nearest.distance <= nearest.site.radius_m ? "var(--tone-ok)" : "var(--tone-warn)" }}
        >
          <LocateFixed className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">
            {nearest.distance <= nearest.site.radius_m
              ? `อยู่ในระยะของ ${nearest.site.name}`
              : `ห่างจาก ${nearest.site.name} ${metersLabel(nearest.distance)} (รัศมี ${metersLabel(nearest.site.radius_m)})`}
          </span>
        </div>
      )}
    </div>
  );
}

function MapMessage({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-(--ink-soft)">
      {icon}
      {children}
    </div>
  );
}

/** ระยะทางบนพื้นโลก (เมตร) — ใช้ตอนยังไม่มี Leaflet map ให้เรียก map.distance() */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
