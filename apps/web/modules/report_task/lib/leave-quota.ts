/**
 * Monthly leave accrual with optional rollover expiry — a "use it or lose it"
 * PTO ledger. Each calendar month grants `monthlyGrant` days; unused days
 * carry over indefinitely unless `expiryMonths` is set, in which case a given
 * month's grant is forfeited once that many months have passed unused.
 * Consumption is FIFO (oldest grant first), so a request always eats into the
 * soonest-to-expire balance before a fresher one — the same order a person
 * would want to use their own leave in to avoid losing days.
 */

export interface LeaveUsageEntry {
  /** Any date within the leave period — used only to bucket the usage by month. */
  date: string;
  days: number;
}

export interface MonthlyQuotaStatus {
  grantedThisMonth: number;
  usedThisMonth: number;
  /** Total usable balance right now, across every not-yet-expired month's grant. */
  availableNow: number;
  /** The soonest a chunk of balance will be forfeited if untouched, if `expiryMonths` is set.
   *  `lastUsableMonthKey` is the last calendar month ("YYYY-MM") that chunk can still be spent in —
   *  it's forfeited starting the month after. */
  nextExpiry?: { inMonths: number; amount: number; lastUsableMonthKey: string };
  /** The last calendar month ("YYYY-MM") this month's own grant can still be spent in, if `expiryMonths` is set. */
  thisMonthLastUsableKey?: string;
}

/** Resolves how many days are granted for a given calendar month ("YYYY-MM") — either the same flat number every month, or (e.g.) a count of that month's public holidays for a country-sourced grant. */
export type MonthlyGrantResolver = number | ((monthKey: string) => number);

function resolveGrant(grant: MonthlyGrantResolver, monthKey: string): number {
  return typeof grant === "function" ? grant(monthKey) : grant;
}

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMonthsToKey(ym: string, n: number): string {
  // ym มาจาก ymKey() เสมอ จึงเป็น "YYYY-MM" ที่แยกได้ 2 ส่วนแน่นอน
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + n, 1);
  return ymKey(d);
}
function keyCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function computeMonthlyLeaveStatus(
  monthlyGrant: MonthlyGrantResolver,
  expiryMonths: number | undefined,
  usage: LeaveUsageEntry[],
  asOf: Date
): MonthlyQuotaStatus {
  const asOfKey = ymKey(asOf);
  // Far enough back that even a generous expiry window is fully covered —
  // 24 months is already more headroom than any realistic policy needs.
  const lookback = Math.max(24, (expiryMonths ?? 0) + 2);
  const startKey = addMonthsToKey(asOfKey, -lookback);

  const buckets: { month: string; remaining: number }[] = [];
  for (let k = startKey; keyCompare(k, asOfKey) <= 0; k = addMonthsToKey(k, 1)) {
    buckets.push({ month: k, remaining: resolveGrant(monthlyGrant, k) });
  }

  const sortedUsage = [...usage].sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of sortedUsage) {
    const usageKey = ymKey(new Date(entry.date));
    let left = entry.days;
    for (const bucket of buckets) {
      if (left <= 0) break;
      if (keyCompare(bucket.month, usageKey) > 0) break; // not granted yet at the time this usage happened
      if (expiryMonths !== undefined && keyCompare(addMonthsToKey(bucket.month, expiryMonths), usageKey) <= 0) continue; // already expired by then
      const take = Math.min(bucket.remaining, left);
      bucket.remaining -= take;
      left -= take;
    }
  }

  const activeBuckets = buckets.filter(
    (b) => expiryMonths === undefined || keyCompare(addMonthsToKey(b.month, expiryMonths), asOfKey) > 0
  );
  const availableNow = activeBuckets.reduce((sum, b) => sum + b.remaining, 0);
  const usedThisMonth = sortedUsage
    .filter((e) => ymKey(new Date(e.date)) === asOfKey)
    .reduce((sum, e) => sum + e.days, 0);

  let nextExpiry: MonthlyQuotaStatus["nextExpiry"];
  if (expiryMonths !== undefined) {
    const upcoming = activeBuckets
      .filter((b) => b.remaining > 0)
      .map((b) => ({ expiryKey: addMonthsToKey(b.month, expiryMonths), amount: b.remaining }))
      .sort((a, b) => keyCompare(a.expiryKey, b.expiryKey))[0];
    if (upcoming) {
      const [ey, em] = upcoming.expiryKey.split("-").map(Number) as [number, number];
      const [ay, am] = asOfKey.split("-").map(Number) as [number, number];
      nextExpiry = {
        inMonths: (ey - ay) * 12 + (em - am),
        amount: upcoming.amount,
        lastUsableMonthKey: addMonthsToKey(upcoming.expiryKey, -1),
      };
    }
  }

  return {
    grantedThisMonth: resolveGrant(monthlyGrant, asOfKey),
    usedThisMonth,
    availableNow,
    nextExpiry,
    thisMonthLastUsableKey: expiryMonths !== undefined ? addMonthsToKey(asOfKey, expiryMonths - 1) : undefined,
  };
}
