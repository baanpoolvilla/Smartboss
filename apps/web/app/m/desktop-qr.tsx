"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";

/**
 * true = เปิดจากคอมพิวเตอร์ (เมาส์ ไม่ใช่จอสัมผัส และไม่ใช่มือถือ/แท็บเล็ต)
 *
 * คอมไม่มี GPS — ตำแหน่งเดาจาก Wi-Fi คลาดเป็นร้อยเมตรถึงหลายกิโล ด่าน GPS (api/m/checkin gpsGate)
 * จึงปัดตกเกือบทุกครั้ง ⇒ บนคอมโชว์ QR ให้สแกนไปลงเวลาบนมือถือแทนปุ่ม (เจ้าของงานตัดสิน 2026-10-07)
 * คืน null ระหว่างยังไม่รู้ (เรนเดอร์ฝั่งเซิร์ฟเวอร์ไม่มี window) — ผู้เรียกยังไม่ต้องโชว์อะไร
 */
export function useIsDesktop(): boolean | null {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent);
    // iPadOS ปลอมตัวเป็น Mac — แยกด้วยจอสัมผัส
    const touchMac = /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ต้องอ่าน navigator/matchMedia หลัง mount (ไม่มีบนเซิร์ฟเวอร์)
    setDesktop(!mobileUa && !touchMac && finePointer);
  }, []);
  return desktop;
}

/** QR ของหน้านี้เอง — สแกนด้วยกล้องมือถือแล้วเปิดหน้าลงเวลาบนมือถือทันที */
export function DesktopQr() {
  const [src, setSrc] = useState<string | null>(null);
  // โชว์เฉพาะหลัง useIsDesktop รู้ผลแล้ว (หลัง mount) ⇒ อ่าน window ตอนสร้าง state ได้ ไม่มีรอบ SSR
  const [url] = useState(() => `${window.location.origin}${window.location.pathname}`);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M" })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-(--line) bg-(--bg-soft) p-5 text-center">
      <div className="flex items-center gap-2 text-base font-bold text-(--ink)">
        <Smartphone className="h-5 w-5" /> ลงเวลาด้วยมือถือ
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL ที่สร้างในเครื่อง ไม่ต้องผ่าน next/image
        <img src={src} alt="QR สำหรับเปิดหน้าลงเวลาบนมือถือ" width={180} height={180} className="rounded-lg bg-white p-2" />
      ) : (
        <div className="h-[180px] w-[180px] animate-pulse rounded-lg bg-(--line)" />
      )}
      <p className="text-sm text-(--ink)">สแกนด้วยกล้องมือถือ แล้วกดลงเวลาได้เลย</p>
      <p className="text-xs text-(--ink-soft)">
        คอมพิวเตอร์ไม่มี GPS จึงลงเวลาจากคอมไม่ได้ — ใช้มือถือ หรือสแกนนิ้วที่เครื่อง
      </p>
      {url && <p className="max-w-full break-all text-[11px] text-(--ink-soft)">{url}</p>}
    </div>
  );
}
