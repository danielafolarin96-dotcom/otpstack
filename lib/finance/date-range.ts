// Preset date-range resolution for the admin Finance page's Today/7 days/30
// days/This month/Custom filters. Pure and unit-tested (date-range.test.ts)
// — the page passes the result straight to summarizeFinanceEvents' fromDate/
// toDate filters.
//
// OtpStack's users and admin are Nigeria-based, but this runs on Vercel
// (UTC) — "Today" has to mean a Lagos calendar day, not a UTC one, or it's
// off by an hour at both ends. Africa/Lagos is UTC+1 year-round (no DST),
// so a fixed offset is exact, unlike most timezones.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export type DateRangePreset = "today" | "7d" | "30d" | "month" | "custom";

export interface ResolvedDateRange {
  fromDate: string | null; // ISO, inclusive
  toDate: string | null; // ISO, exclusive
}

interface Ymd {
  y: number;
  m: number; // 0-indexed, matches Date's month convention
  d: number;
}

// The Y/M/D of `date` as seen on a Lagos wall clock.
function lagosYmd(date: Date): Ymd {
  const shifted = new Date(date.getTime() + LAGOS_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

// ISO instant for Lagos midnight on the given Y/M/D (+ an optional day
// offset) — Date.UTC normalizes out-of-range days/months on its own (e.g.
// day 0 rolls back into the previous month), so offsets across month/year
// boundaries don't need special-casing here.
function lagosMidnightIso(ymd: Ymd, dayOffset = 0): string {
  const utcMs = Date.UTC(ymd.y, ymd.m, ymd.d + dayOffset) - LAGOS_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

// "YYYY-MM-DD" (an <input type="date"> value) -> Ymd, interpreted as a
// Lagos calendar date rather than parsed as a UTC instant.
function parseDateInputValue(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

export function resolveDateRangePreset(
  preset: DateRangePreset,
  now: Date = new Date(),
  custom?: { from?: string | null; to?: string | null },
): ResolvedDateRange {
  const today = lagosYmd(now);

  switch (preset) {
    case "today":
      return { fromDate: lagosMidnightIso(today), toDate: null };
    case "7d":
      return { fromDate: lagosMidnightIso(today, -6), toDate: null };
    case "30d":
      return { fromDate: lagosMidnightIso(today, -29), toDate: null };
    case "month":
      return { fromDate: lagosMidnightIso({ ...today, d: 1 }), toDate: null };
    case "custom": {
      const from = custom?.from ? parseDateInputValue(custom.from) : null;
      const to = custom?.to ? parseDateInputValue(custom.to) : null;
      return {
        fromDate: from ? lagosMidnightIso(from) : null,
        // Exclusive upper bound, one day past the selected end date, so the
        // whole end date is included.
        toDate: to ? lagosMidnightIso(to, 1) : null,
      };
    }
    default:
      return { fromDate: null, toDate: null };
  }
}
