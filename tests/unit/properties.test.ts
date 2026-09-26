// Properties over generated inputs, the way the Elixir sibling's
// cii_property_test and totals_property_test do it: the round-trip and the
// arithmetic must hold for any invoice, not only the handful written by hand.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { add, cmp, dec, mul, parseDecimal, round, toFixed, toKey, toText } from '../../src/decimal.js';
import { computeTotals } from '../../src/totals.js';
import { validateEn16931 } from '../../src/profiles/en16931.js';
import { serialize } from '../../src/xml/serializer.js';
import { deserialize } from '../../src/xml/deserializer.js';
import type { DraftInvoice, DraftLineItem, VatCategoryCode } from '../../src/types/index.js';
import { atWireScale, sampleInvoice } from '../fixtures/invoice.js';

/** A decimal string with up to `scale` fraction digits, from an integer count of units. */
const decimalText = (maxUnits: number, scale: number, min = 0): fc.Arbitrary<string> =>
  fc.integer({ min, max: maxUnits }).map((units) => toText({ units: BigInt(units), scale }));

describe('decimal arithmetic', () => {
  const anyDecimal = fc
    .tuple(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), fc.integer({ min: 0, max: 8 }))
    .map(([units, scale]) => ({ units, scale }));

  it('reads back its own text exactly', () => {
    fc.assert(
      fc.property(anyDecimal, (d) => {
        const parsed = parseDecimal(toText(d));
        return parsed.ok && cmp(parsed.value, d) === 0 && parsed.value.scale === d.scale;
      }),
    );
  });

  it('rounds to the nearest representable value, ties away from zero', () => {
    fc.assert(
      fc.property(anyDecimal, fc.integer({ min: 0, max: 4 }), (d, places) => {
        const r = round(d, places);
        // |d - r| <= half a unit in the last place, checked at a common scale.
        const scale = Math.max(d.scale, places) + 1;
        const toScale = (x: { units: bigint; scale: number }) => x.units * 10n ** BigInt(scale - x.scale);
        const diff = toScale(d) - toScale(r);
        const half = 5n * 10n ** BigInt(scale - places - 1);
        const absDiff = diff < 0n ? -diff : diff;
        if (absDiff > half) return false;
        // On an exact tie the result is the one further from zero.
        if (absDiff === half) return (d.units < 0n ? toScale(r) < toScale(d) : toScale(r) > toScale(d)) || d.units === 0n;
        return true;
      }),
    );
  });

  // Exact ties are vanishingly rare among random decimals, so they get their
  // own generator: k + 0.5 units in the last kept place, either sign.
  it('rounds every exact tie away from zero', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), fc.integer({ min: 0, max: 4 }), (k, places) => {
        const tie = { units: k * 10n + (k < 0n ? -5n : 5n), scale: places + 1 };
        const expected = { units: k + (k < 0n ? -1n : 1n), scale: places };
        // k = 0 is +0.5 (away from zero is up); the sign comes from k alone.
        return cmp(round(tie, places), expected) === 0;
      }),
    );
  });

  it('adds and multiplies commutatively, and keys equal values alike', () => {
    fc.assert(
      fc.property(anyDecimal, anyDecimal, (a, b) => {
        expect(toKey(add(a, b))).toBe(toKey(add(b, a)));
        expect(toKey(mul(a, b))).toBe(toKey(mul(b, a)));
        const rescaled = { units: a.units * 100n, scale: a.scale + 2 };
        expect(toKey(rescaled)).toBe(toKey(a));
      }),
    );
  });

  it('accepts any number carrying six decimals or fewer, as the value it reads as', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: 0, max: 6 }), (units, scale) => {
        const n = units / 10 ** scale;
        const parsed = parseDecimal(n);
        // Division itself may drift (e.g. 1/10**6 is fine, 7/10**2 is 0.07), so
        // compare with what the number prints as — the caller's own value.
        if (!parsed.ok) return /e|\.\d{7,}/.test(String(n));
        return toText(parsed.value) === String(n).replace(/^-0$/, '0');
      }),
    );
  });
});

// ---- invoices --------------------------------------------------------------

const RATES: readonly [VatCategoryCode, string][] = [
  ['S', '20'],
  ['S', '10'],
  ['S', '5.5'],
  ['S', '2.1'],
  ['Z', '0'],
];

const lineArb: fc.Arbitrary<DraftLineItem> = fc
  .record({
    quantity: decimalText(100_000, 3, 1),
    netPrice: decimalText(10_000_000, 4, 0),
    rate: fc.constantFrom(...RATES),
    allowance: fc.option(decimalText(1_000, 2, 1), { nil: undefined }),
  })
  .map(({ quantity, netPrice, rate: [vatCategory, vatRate], allowance }, ) => ({
    id: '0',
    name: 'Article',
    quantity,
    unit: 'C62',
    netPrice,
    vatCategory,
    vatRate,
    ...(allowance !== undefined ? { allowances: [{ amount: allowance, reason: 'Remise', vatCategory, vatRate }] } : {}),
  }));

const draftArb: fc.Arbitrary<DraftInvoice> = fc
  .record({
    lines: fc.array(lineArb, { minLength: 1, maxLength: 6 }),
    prepaid: fc.option(decimalText(1_000, 2, 0), { nil: undefined }),
    rounding: fc.option(decimalText(99, 2, -99), { nil: undefined }),
  })
  .map(({ lines, prepaid, rounding }) => {
    const { totals: _t, taxBreakdown: _tb, allowances: _a, lines: _l, ...header } = sampleInvoice();
    return {
      ...header,
      lines: lines.map((line, i) => ({ ...line, id: String(i + 1) })),
      totals: { ...(prepaid !== undefined ? { prepaid } : {}), ...(rounding !== undefined ? { rounding } : {}) },
    };
  });

describe('computeTotals', () => {
  it('always produces an invoice validateEn16931 accepts, whose sums hold exactly', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const result = computeTotals(draft);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { invoice } = result;
        expect(validateEn16931(invoice).errors).toEqual([]);

        const t = invoice.totals;
        const sum = (xs: readonly string[]) => xs.reduce((acc, x) => add(acc, dec(x)), dec(0));
        // BR-CO-10, BR-CO-14, BR-CO-15, BR-CO-16 — exact, not within a tolerance.
        expect(toFixed(sum(invoice.lines.map((l) => l.lineTotal)), 2)).toBe(t.lineTotal);
        expect(toFixed(sum(invoice.taxBreakdown.map((tb) => tb.calculatedAmount)), 2)).toBe(t.taxTotal);
        expect(toFixed(add(dec(t.taxBasisTotal), dec(t.taxTotal)), 2)).toBe(t.grandTotal);
        const due = add(add(dec(t.grandTotal), mul(dec(t.prepaid ?? '0'), dec(-1))), dec(t.rounding ?? '0'));
        expect(toFixed(due, 2)).toBe(t.duePayable);
      }),
      { numRuns: 200 },
    );
  });

  it('agrees with a figure it derived itself when that figure is stated back', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const first = computeTotals(draft);
        if (!first.ok) return false;
        const again = computeTotals({ ...draft, totals: first.invoice.totals });
        return again.ok;
      }),
      { numRuns: 100 },
    );
  });
});

describe('serialize → deserialize', () => {
  it('gives back every derived invoice at wire scale, at EN 16931 and EXTENDED', () => {
    fc.assert(
      fc.property(draftArb, fc.constantFrom('EN 16931' as const, 'EXTENDED' as const), (draft, profile) => {
        const result = computeTotals(draft);
        if (!result.ok) return false;
        const back = deserialize(serialize(result.invoice, profile));
        const expected = atWireScale(result.invoice);
        // The deserializer lifts a uniform BT-8 to the document level; the
        // sample header carries one, so compare everything but that shape.
        expect(back.lines).toEqual(expected.lines);
        expect(back.totals).toEqual(expected.totals);
        expect(back.taxBreakdown.map(({ dueDateTypeCode: _d, ...tb }) => tb)).toEqual(
          expected.taxBreakdown.map(({ dueDateTypeCode: _d, ...tb }) => tb),
        );
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
