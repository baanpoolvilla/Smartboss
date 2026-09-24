import { requireOrg } from "@smartboss/auth";

import { clearPresenceIfIdle, subscribeUser, touchPresence, type RealtimeEvent } from "@/lib/realtime/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** heartbeat ถี่กว่า timeout ของ proxy ทั่วไป (Caddy/เบราว์เซอร์ ~60 วิ) และใช้ต่ออายุ "ออนไลน์" */
const HEARTBEAT_MS = 25_000;

/**
 * ท่อสดของผู้ใช้ (Server-Sent Events) — เบราว์เซอร์ต่อค้างไว้หนึ่งเส้นต่อแท็บ
 * (lib/realtime-client.ts) แล้วรับเหตุการณ์ทุกโมดูลผ่านเส้นเดียว
 *
 * ใช้ SSE ไม่ใช่ WebSocket: ทางเดียว (เซิร์ฟเวอร์ → เครื่อง) พอสำหรับงานนี้ ส่งข้อความ
 * ยังเป็น HTTP POST ปกติ, ทำงานผ่าน Caddy/Next route handler ได้ตรง ๆ ไม่ต้องมี
 * โปรเซสแยก และ EventSource ต่อใหม่เองเมื่อหลุด
 */
export async function GET(request: Request) {
  const session = await requireOrg();
  const userId = session.userId;
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // บอกเบราว์เซอร์ให้รอ 3 วิก่อนต่อใหม่เมื่อหลุด แล้วส่ง "ready" ให้ฝั่งเครื่องรู้ว่าต่อสำเร็จ
      send(`retry: 3000\nevent: ready\ndata: {}\n\n`);
      touchPresence(userId);

      const unsubscribe = subscribeUser(userId, session.orgId, (event: RealtimeEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => {
        touchPresence(userId);
        send(`: ping\n\n`);
      }, HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        clearPresenceIfIdle(userId);
        try {
          controller.close();
        } catch {
          // ปิดไปแล้ว
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform = ไม่ให้ Caddy (encode gzip) กับ proxy อื่นบีบอัด/พักข้อมูลไว้ก่อนส่ง
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
