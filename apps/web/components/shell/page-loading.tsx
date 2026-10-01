/**
 * โครงหน้าระหว่างรอเซิร์ฟเวอร์สร้างหน้าใหม่ (ใช้ใน loading.tsx ของโมดูลที่วาง
 * แถบบน/เมนูไว้ใน layout — ส่วนนั้นอยู่ที่เดิม เปลี่ยนแค่พื้นที่เนื้อหาเป็นกล่องเทา
 * ทันทีที่กด แทนที่จอจะนิ่งจนหน้าใหม่เสร็จ) — ไม่มีข้อมูลจริง ไม่ต้องแปลภาษา
 */
export function PageLoading() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-label="กำลังโหลด">
      <div className="h-7 w-48 max-w-full animate-pulse rounded-lg bg-(--line) motion-reduce:animate-none" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-(--line) motion-reduce:animate-none" />
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-(--line) opacity-70 motion-reduce:animate-none" />
      ))}
    </div>
  );
}
