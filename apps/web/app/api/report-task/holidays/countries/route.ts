// Proxies Nager.Date's free, no-key public holiday API (https://date.nager.at) —
// server-side so the browser never talks to a third-party host directly.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("https://date.nager.at/api/v3/AvailableCountries", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return Response.json({ error: "โหลดรายชื่อประเทศไม่สำเร็จ" }, { status: 502 });
    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: "เชื่อมต่อผู้ให้บริการวันหยุดไม่ได้" }, { status: 502 });
  }
}
