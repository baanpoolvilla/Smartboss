import type { NextRequest } from "next/server";

// Proxies Nager.Date's free, no-key public holiday API (https://date.nager.at) —
// server-side so the browser never talks to a third-party host directly.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year");
  const country = searchParams.get("country");
  if (!year || !country) {
    return Response.json({ error: "ต้องระบุปีและประเทศ" }, { status: 400 });
  }
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, {
      headers: { Accept: "application/json" },
      // Holiday calendars change essentially never — cache upstream response for
      // a day so a burst of clients doesn't hammer (and risk getting throttled
      // by) the third-party API.
      next: { revalidate: 86400 },
    });
    // The upstream API returns 204 (empty body) for a country/year it has no
    // data for — not an error, just nothing to import.
    if (res.status === 204) return Response.json([]);
    if (!res.ok) return Response.json({ error: "โหลดวันหยุดไม่สำเร็จ" }, { status: 502 });
    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: "เชื่อมต่อผู้ให้บริการวันหยุดไม่ได้" }, { status: 502 });
  }
}
