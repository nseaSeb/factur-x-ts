// src/amounts.ts
// Shared money arithmetic. EN 16931 amounts are 2-decimal by contract, and the
// official Schematron's header-sum rules (BR-CO-10/11/12/13/14/15/16) compare
// exactly after rounding the sum to cents once — not with a fixed absolute
// slack.

/**
 * Round to the cent the way the wire format does.
 *
 * `toFixed`, not `Math.round(x * 100)`, for one reason only: the serializer
 * writes amounts with `toFixed(2)`, so rounding the same way guarantees the
 * number kept in the model re-serializes to the string it was rounded to, and
 * the BR-CO-10..16 sums stay self-consistent on the wire.
 *
 * Neither form is decimal half-up. `(1.005).toFixed(2)` is "1.00" — 1.005 is
 * stored as 1.00499999999999989 and both forms floor it — while 2.675 splits
 * them ("2.67" against 2.68). A half-cent tie therefore follows the float
 * representation, not the arithmetic rule; BR-CO-17's tolerance is a full
 * currency unit, so either side of a tie is accepted.
 */
export function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Snap float noise to exact zero.
 *
 * One trap `toFixed` doesn't save you from: a subtraction/addition chain (e.g.
 * lineTotal - allowanceTotal + chargeTotal) that is mathematically exactly zero
 * can land on a tiny negative float instead (-3.469e-18, not -0), and
 * (-3.469e-18).toFixed(2) is the string "-0.00" — not "0.00", even though
 * (-0).toFixed(2) IS "0.00". Snapping anything far below cent precision to
 * exact 0 avoids that false mismatch without masking any real one (a genuine
 * difference is always >= 0.005, twelve orders of magnitude above the
 * threshold).
 */
export function snapNearZero(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

/** Equality as the Schematron sees it: both sides rounded to cents once, then compared exactly. */
export function isClose(a: number, b: number): boolean {
  return snapNearZero(a).toFixed(2) === snapNearZero(b).toFixed(2);
}
