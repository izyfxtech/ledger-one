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
// write of a rate column (interest_rate, fx_rates.rate).

/** Money is stored ×100 (2 decimal places). Enough for the currencies
 *  LedgerOne targets; if a zero-decimal currency (JPY) or three-decimal
 *  (KWD) is added later, promote to a per-currency scale table. */
export const MONEY_SCALE = 100;

/** Rates are stored ×1_000_000 (6 decimal places). Covers FX and
 *  interest rates to well past display precision without float drift. */
export const RATE_SCALE = 1_000_000;

export function toMoneyMinor(major: number): number;
export function toMoneyMinor(major: number | null | undefined): number | null;
export function toMoneyMinor(major: number | null | undefined): number | null {
  if (major === null || major === undefined) return null;
  if (!Number.isFinite(major)) {
    throw new RangeError(`toMoneyMinor: non-finite value ${major}`);
  }
  return Math.round(major * MONEY_SCALE);
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
