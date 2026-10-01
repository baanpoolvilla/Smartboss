/**
 * ระหว่างรอเซิร์ฟเวอร์สร้างหน้าใหม่ (loading.tsx ของโมดูลที่วางแถบบน/เมนูไว้ใน layout)
 *
 * วงหมุนเล็ก ๆ กลางพื้นที่เนื้อหา — โผล่หลัง 300ms เท่านั้น หน้าที่มาเร็วจะไม่กระพริบ
 * เดิมเป็นกล่องเทาแบบการ์ด ซึ่งไม่ตรงกับหน้าแชท (รายการห้อง + ข้อความ) ดูแปลก
 * แถบโหลดด้านบน (navigation-progress.tsx) บอกว่ากำลังโหลดตั้งแต่ตอนกดอยู่แล้ว
 */
export function PageLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" aria-busy="true" aria-label="กำลังโหลด">
      <span
        className="h-7 w-7 animate-spin rounded-full border-[3px] border-(--line) border-t-(--brand-green) opacity-0 motion-reduce:animate-none"
        style={{ animation: "page-loading-in 0s linear 300ms forwards, spin 0.8s linear infinite" }}
      />
      <style>{`@keyframes page-loading-in { to { opacity: 1 } }`}</style>
    </div>
  );
}
