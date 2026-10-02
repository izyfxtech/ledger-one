/** Today as YYYY-MM-DD in the user's *local* time zone. `toISOString()` is
 *  UTC, which is yesterday for late-evening entries west of Greenwich and
 *  tomorrow for early-morning entries east of it. */
export function todayLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function currentMonthLocal(d = new Date()): string {
  return todayLocal(d).slice(0, 7);
}

/** Same calendar day `years` ahead, in local time. */
export function todayPlusYears(years: number, from = new Date()): string {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + years);
  return todayLocal(d);
}

/** "2026-09" -> "2026-10" (and across year ends), without Date quirks. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
