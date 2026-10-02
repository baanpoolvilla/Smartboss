"use client";

import { useEffect } from "react";

/**
 * ระหว่างที่หน้าดูรูปเต็มจอเปิดอยู่ ให้แถบสถานะ/แถบเบราว์เซอร์ของเครื่องเป็นสีดำ (แบบ Discord)
 * — เดิมรูปขึ้นเต็มจอพื้นดำ แต่แถบสถานะด้านบนยังขาว (themeColor ของแอป #ffffff ใน app/layout.tsx)
 *
 * เปลี่ยน <meta name="theme-color"> ชั่วคราวแล้วคืนค่าเดิมตอนปิด นับจำนวนผู้ใช้ไว้ เผื่อเปิดซ้อนกัน
 * (เช่น หน้าวาดบนรูปซ้อนหน้าดูรูป) — อันสุดท้ายปิดถึงจะคืนสี
 * Android (Chrome/แอปที่ติดตั้ง) และ Safari ใช้ค่านี้ทันที · iPhone แอปที่ติดตั้งบางรุ่นไม่เปลี่ยนตาม
 */
let users = 0;
let saved: { el: HTMLMetaElement; content: string | null; created: boolean }[] = [];

export function useBlackSystemBars() {
  useEffect(() => {
    users += 1;
    if (users === 1) {
      const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
      if (metas.length === 0) {
        const el = document.createElement("meta");
        el.name = "theme-color";
        document.head.appendChild(el);
        saved = [{ el, content: null, created: true }];
      } else {
        saved = metas.map((el) => ({ el, content: el.getAttribute("content"), created: false }));
      }
      for (const m of saved) m.el.setAttribute("content", "#000000");
    }
    return () => {
      users -= 1;
      if (users > 0) return;
      for (const m of saved) {
        if (m.created) m.el.remove();
        else if (m.content !== null) m.el.setAttribute("content", m.content);
      }
      saved = [];
    };
  }, []);
}
