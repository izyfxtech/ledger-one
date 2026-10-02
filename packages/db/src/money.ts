// Money and rate encoding at the DB boundary.
//
// Rationale: SQLite REAL columns (IEEE-754 doubles) accumulate visible
// rounding drift when a running balance is computed by summing many rows
// (0.1 + 0.2 !== 0.3). LedgerOne stores all monetary values as INTEGER
// minor units (cents / kobo) and all rate values as INTEGER scaled by
// RATE_SCALE. Conversion happens ONLY here, at the DB boundary, so the
// rest of the app keeps treating amounts as plain "major-unit" numbers.
//
// Use `toMoneyMinor` / `fromMoneyMinor` at every INSERT / UPDATE / SELECT
// of a money column, and `toRateMinor` / `fromRateMinor` at every read /
// write of interest_rate. Amounts round half AWAY from zero (same as Rust's
// f64::round); Math.round alone rounds -12.5 to -12 instead of -13.

/** Money is stored ×100 (2 decimal places). Enough for the currencies
 *  LedgerOne targets; if a zero-decimal currency (JPY) or three-decimal
 *  (KWD) is added later, promote to a per-currency scale table. */
export const MONEY_SCALE = 100;

/** Interest rates (percent) are stored ×1_000_000 (6 decimal places).
 *  FX rates are NOT scaled any more: a strong-to-weak pair such as NGN→USD
 *  (~0.00065) kept only ~3 significant digits at this scale, so
 *  fx_rates.rate is a plain REAL since migration 0002. */
export const RATE_SCALE = 1_000_000;

export function toMoneyMinor(major: number): number;
export function toMoneyMinor(major: number | null | undefined): number | null;
export function toMoneyMinor(major: number | null | undefined): number | null {
  if (major === null || major === undefined) return null;
  if (!Number.isFinite(major)) {
    throw new RangeError(`toMoneyMinor: non-finite value ${major}`);
  }
  const scaled = Math.abs(major) * MONEY_SCALE;
  return major < 0 ? -Math.round(scaled) : Math.round(scaled);
}

export function fromMoneyMinor(minor: number): number;
export function fromMoneyMinor(minor: number | null | undefined): number | null;
export function fromMoneyMinor(minor: number | null | undefined): number | null {
  if (minor === null || minor === undefined) return null;
  return minor / MONEY_SCALE;
}

export function toRateMinor(major: number): number;
export function toRateMinor(major: number | null | undefined): number | null;
export function toRateMinor(major: number | null | undefined): number | null {
  if (major === null || major === undefined) return null;
  if (!Number.isFinite(major)) {
    throw new RangeError(`toRateMinor: non-finite value ${major}`);
  }
  return Math.round(major * RATE_SCALE);
}

export function fromRateMinor(minor: number): number;
export function fromRateMinor(minor: number | null | undefined): number | null;
export function fromRateMinor(minor: number | null | undefined): number | null {
  if (minor === null || minor === undefined) return null;
  return minor / RATE_SCALE;
}
