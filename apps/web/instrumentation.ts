/**
 * ตัววัดความเร็วฝั่งเซิร์ฟเวอร์ — เขียนลง log อย่างเดียว ไม่แตะหน้าจอหรือข้อมูลใด ๆ
 * (ผู้ใช้ 18/11/2569 "ย้ายหน้าหน่วง โหลดข้อมูลช้า" · ฐานข้อมูลตอบ 1–3 ms แต่ API เล็ก ๆ ใช้ 0.8 วิ
 *  ⇒ สงสัยว่า next-server ตัวเดียวติดคิวจากงานหนัก ต้องวัดก่อนแก้)
 *
 * ทุก 60 วินาที: ถ้า event loop หน่วง (p99 ≥ 100 ms) เขียน "[perf] event-loop …" ลง journal
 * คิวรีที่ช้า ≥ 300 ms เขียนแยกจาก packages/database/client.ts ("[perf] slow query …")
 * ดู: journalctl -u smartboss-web --since today | grep '\[perf\]'
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { monitorEventLoopDelay } = await import("node:perf_hooks");
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const ms = (ns: number) => Math.round(ns / 1e6);
  const timer = setInterval(() => {
    const p99 = ms(h.percentile(99));
    if (p99 >= 100) {
      const mem = process.memoryUsage();
      console.warn(
        `[perf] event-loop p50=${ms(h.percentile(50))}ms p99=${p99}ms max=${ms(h.max)}ms heap=${Math.round(mem.heapUsed / 1048576)}MB rss=${Math.round(mem.rss / 1048576)}MB`,
      );
    }
    h.reset();
  }, 60_000);
  timer.unref();
}
