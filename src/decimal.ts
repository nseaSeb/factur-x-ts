// src/decimal.ts
// Exact decimal arithmetic for invoice amounts, on scaled BigInts.
//
// A value is `units / 10^scale`: "12.50" is { units: 1250n, scale: 2 }. Every
// operation here is exact except `round`, which rounds half away from zero —
// the commercial rule EN 16931 implementations use, and the one a float can
// only approximate ((1.005).toFixed(2) is "1.00"). Nothing is ever converted
// back to a float.
//
// Why no dependency: the arithmetic an invoice needs is add, subtract,
// multiply, compare and round — never divide by anything but a power of ten.
// That fits in a page, and keeps a parser of third-party amounts free of a
// library's own parsing surface (the Elixir sibling had to ship a CVE fix for
// exactly that: an unbounded exponent in `Decimal.parse`).

/** A decimal as callers may supply it: a string in `xsd:decimal` form, or a number. */
export type DecimalInput = string | number;

export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

/** Why an input is not accepted as a decimal. */
export type DecimalRefusal = 'NOT_FINITE' | 'FLOAT_DRIFT' | 'NOT_A_DECIMAL' | 'TOO_LONG';

// xsd:decimal's lexical space, and nothing wider: no exponent, no hex, no
// "Infinity"/"NaN", no thousands separator or decimal comma — all of which
// Number() would accept and turn into a plausible-looking figure.
const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** No real amount, quantity or rate needs more; a longer string is refused before anything computes with it. */
export const MAX_DECIMAL_LENGTH = 32;

/**
 * The most fraction digits a `number` may carry.
 *
 * A number that got here through float arithmetic usually shows it:
 * `0.1 + 0.2` is `0.30000000000000004`, `4.35 * 100` is `434.99999999999994`.
 * Drift lands at 14 to 17 digits; nothing an invoice states needs more than 4
 * (unit prices, quantities). Six leaves room for a stated precision without
 * letting drift through. A string is not subject to this: it was written, not
 * computed.
 */
export const MAX_NUMBER_FRACTION_DIGITS = 6;

export type ParsedDecimal = { readonly ok: true; readonly value: Decimal } | { readonly ok: false; readonly reason: DecimalRefusal };

export function parseDecimal(input: DecimalInput): ParsedDecimal {
  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, reason: 'NOT_FINITE' };
    // String(n) is the shortest text that reads back as n — what the caller
    // typed, for any literal. An exponent means a value too large or too small
    // to be an amount (1e21, 1e-7).
    text = String(input);
    if (/e/i.test(text)) return { ok: false, reason: 'NOT_A_DECIMAL' };
    const fraction = text.split('.')[1] ?? '';
    if (fraction.length > MAX_NUMBER_FRACTION_DIGITS) return { ok: false, reason: 'FLOAT_DRIFT' };
  } else if (typeof input === 'string') {
    text = input;
  } else {
    return { ok: false, reason: 'NOT_A_DECIMAL' };
  }

  if (text.length > MAX_DECIMAL_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  const match = DECIMAL_TEXT.exec(text);
  const [, sign = '', whole = '', fraction = ''] = match ?? [];
  if (!match || (whole === '' && fraction === '')) return { ok: false, reason: 'NOT_A_DECIMAL' };

  const magnitude = BigInt((whole || '0') + fraction);
  return { ok: true, value: { units: sign === '-' ? -magnitude : magnitude, scale: fraction.length } };
}

/** Explains a refusal to a caller, naming what they passed. */
export function describeRefusal(input: unknown, reason: DecimalRefusal): string {
  const shown = typeof input === 'string' ? `"${input}"` : String(input);
  switch (reason) {
    case 'NOT_FINITE':
      return `${shown} is not a finite number`;
    case 'FLOAT_DRIFT':
      return `${shown} has more than ${MAX_NUMBER_FRACTION_DIGITS} decimals, which looks like float arithmetic — round it, or pass the amount as a string`;
    case 'TOO_LONG':
      return `${shown} is longer than ${MAX_DECIMAL_LENGTH} characters`;
    case 'NOT_A_DECIMAL':
      return `${shown} is not a decimal number (expected e.g. "1234.56")`;
  }
}

export const ZERO: Decimal = { units: 0n, scale: 0 };

/** Parse a value already known to be valid; throws otherwise (a bug, not bad input). */
export function dec(input: DecimalInput): Decimal {
  const parsed = parseDecimal(input);
  if (!parsed.ok) throw new TypeError(`Invalid decimal reached the arithmetic: ${describeRefusal(input, parsed.reason)}`);
  return parsed.value;
}

function rescale(d: Decimal, scale: number): bigint {
  return d.units * 10n ** BigInt(scale - d.scale);
}

export function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale) + rescale(b, scale), scale };
}

export function sub(a: Decimal, b: Decimal): Decimal {
  return add(a, neg(b));
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function neg(d: Decimal): Decimal {
  return { units: -d.units, scale: d.scale };
}

export function abs(d: Decimal): Decimal {
  return d.units < 0n ? neg(d) : d;
}

/** `basis × percent / 100` — exact: dividing by 100 is a shift of the scale. */
export function percentOf(basis: Decimal, percent: Decimal): Decimal {
  const product = mul(basis, percent);
  return { units: product.units, scale: product.scale + 2 };
}

export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce(add, ZERO);
}

export function cmp(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const x = rescale(a, scale);
  const y = rescale(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function eq(a: Decimal, b: Decimal): boolean {
  return cmp(a, b) === 0;
}

export function sign(d: Decimal): -1 | 0 | 1 {
  return d.units < 0n ? -1 : d.units > 0n ? 1 : 0;
}

/** Round to `places` decimals, half away from zero: 1.005 → 1.01, -1.005 → -1.01. */
export function round(d: Decimal, places: number): Decimal {
  if (d.scale <= places) return { units: rescale(d, places), scale: places };
  const divisor = 10n ** BigInt(d.scale - places);
  const magnitude = d.units < 0n ? -d.units : d.units;
  let quotient = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) quotient += 1n;
  return { units: d.units < 0n ? -quotient : quotient, scale: places };
}

/** Text with exactly `places` decimals, rounded half away from zero. Never "-0.00". */
export function toFixed(d: Decimal, places: number): string {
  return render(round(d, places));
}

/** Text at the value's own scale: "100.00" stays "100.00", "+.5" becomes "0.5". */
export function toText(d: Decimal): string {
  return render(d);
}

/** Text with trailing fraction zeros removed — equal values give equal keys ("20", "20.00" → "20"). */
export function toKey(d: Decimal): string {
  let { units, scale } = d;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return render({ units, scale });
}

function render(d: Decimal): string {
  const negative = d.units < 0n;
  const digits = (negative ? -d.units : d.units).toString().padStart(d.scale + 1, '0');
  const whole = digits.slice(0, digits.length - d.scale);
  const fraction = digits.slice(digits.length - d.scale);
  const text = d.scale > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${text}` : text;
}
