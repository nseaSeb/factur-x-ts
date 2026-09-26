import { describe, expect, it } from 'vitest';
import { computeTotals } from '../../src/totals.js';
import { validateEn16931 } from '../../src/profiles/en16931.js';
import type { DraftInvoice, DraftLineItem } from '../../src/types/index.js';
import { atWireScale, sampleInvoice } from '../fixtures/invoice.js';

/** The sample invoice with every derivable figure stripped back out. */
function draftFromSample(): DraftInvoice {
  const invoice = sampleInvoice();
  const { totals: _totals, ...rest } = invoice;
  return {
    ...rest,
    lines: invoice.lines.map(({ lineTotal: _lineTotal, ...line }) => line),
    taxBreakdown: invoice.taxBreakdown.map(({ basisAmount: _basis, calculatedAmount: _calculated, ...tb }) => tb),
  };
}

/** A bare draft: header, one line, nothing worked out. */
function draft(lines: DraftLineItem[], extra: Partial<DraftInvoice> = {}): DraftInvoice {
  const invoice = sampleInvoice();
  // Dropped, not set to undefined: `exactOptionalPropertyTypes` makes those
  // two different things, and `tests/` is outside the tsconfig that would say so.
  const { totals: _totals, taxBreakdown: _taxBreakdown, allowances: _allowances, ...rest } = invoice;
  return { ...rest, lines, ...extra };
}

const line = (over: Partial<DraftLineItem> = {}): DraftLineItem => ({
  id: '1',
  name: 'Prestation',
  quantity: 1,
  unit: 'C62',
  netPrice: 100,
  vatCategory: 'S',
  vatRate: 20,
  ...over,
});

describe('computeTotals', () => {
  it('derives the line amount, the VAT breakdown and the document totals', () => {
    // 33.33 x 3 = 99.99, and 99.99 x 5.5% = 5.49945, which BR-CO-17 rounds to
    // 5.50 — the case a half-up rounding rule exists for.
    const result = computeTotals(draft([line({ netPrice: 33.33, quantity: 3, vatRate: 5.5 })]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.invoice.lines[0]!.lineTotal).toBe('99.99');
    expect(result.invoice.taxBreakdown).toEqual([
      { type: 'VAT', category: 'S', rate: '5.5', basisAmount: '99.99', calculatedAmount: '5.50' },
    ]);
    expect(result.invoice.totals).toEqual({
      lineTotal: '99.99',
      taxBasisTotal: '99.99',
      taxTotal: '5.50',
      grandTotal: '105.49',
      duePayable: '105.49',
    });
  });

  it('derives a valid EN 16931 invoice from the README example', () => {
    // Keeps the documented snippet honest: it must both produce the figures
    // the README prints and pass the rules `generate` runs before writing.
    const result = computeTotals({
      number: 'FA-2026-0042',
      issueDate: new Date(Date.UTC(2026, 2, 15)),
      currency: 'EUR',
      typeCode: '380',
      seller: { name: 'Vendeur SAS', vatId: 'FR12345678901', address: { country: 'FR' } },
      buyer: { name: 'Acheteur SARL', address: { country: 'FR' } },
      lines: [
        { id: '1', name: 'Prestation', quantity: 3, unit: 'C62', netPrice: 33.33, vatCategory: 'S', vatRate: 5.5 },
      ],
      paymentTerms: '30 jours net',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.invoice.totals.lineTotal).toBe('99.99');
    expect(result.invoice.totals.taxTotal).toBe('5.50');
    expect(result.invoice.totals.grandTotal).toBe('105.49');
    expect(validateEn16931(result.invoice)).toEqual({ valid: true, errors: [] });
  });

  it('produces an invoice that satisfies validateEn16931', () => {
    const result = computeTotals(draftFromSample());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(validateEn16931(result.invoice)).toEqual({ valid: true, errors: [] });
  });

  it('agrees with the figures the sample invoice states', () => {
    const result = computeTotals(draftFromSample());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Amounts come back at two decimals; a rate keeps the caller's own spelling.
    const expected = atWireScale(sampleInvoice());
    expect(result.invoice.totals).toEqual(expected.totals);
    expect(result.invoice.taxBreakdown).toEqual(
      expected.taxBreakdown.map((tb) => ({ ...tb, rate: String(Number(tb.rate)) })),
    );
  });

  it('folds line-level allowances and charges into BT-131', () => {
    const result = computeTotals(
      draft([
        line({
          netPrice: 100,
          quantity: 2,
          allowances: [{ amount: 20, reason: 'Remise', vatCategory: 'S', vatRate: 20 }],
          charges: [{ amount: 5, reason: 'Emballage', vatCategory: 'S', vatRate: 20 }],
        }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.lines[0]!.lineTotal).toBe('185.00');
    expect(result.invoice.totals.lineTotal).toBe('185.00');
    // Folded into the line, so they never reach BT-107 / BT-108.
    expect(result.invoice.totals.allowanceTotal).toBeUndefined();
    expect(result.invoice.totals.chargeTotal).toBeUndefined();
  });

  it('nets document-level allowances and charges into the taxable basis (BR-CO-13)', () => {
    const result = computeTotals(
      draft([line({ netPrice: 100, quantity: 2 })], {
        allowances: [{ amount: 20, reason: 'Remise commerciale', vatCategory: 'S', vatRate: 20 }],
        charges: [{ amount: 5, reason: 'Frais de port', vatCategory: 'S', vatRate: 20 }],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.totals).toMatchObject({
      lineTotal: '200.00',
      allowanceTotal: '20.00',
      chargeTotal: '5.00',
      taxBasisTotal: '185.00',
      taxTotal: '37.00',
      grandTotal: '222.00',
      duePayable: '222.00',
    });
    expect(result.invoice.taxBreakdown[0]!.basisAmount).toBe('185.00');
  });

  it('subtracts a stated BT-113 from BT-115 without deriving it (BR-CO-16)', () => {
    const result = computeTotals(draft([line({ netPrice: 100 })], { totals: { prepaid: 50 } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.totals.grandTotal).toBe('120.00');
    expect(result.invoice.totals.prepaid).toBe('50');
    expect(result.invoice.totals.duePayable).toBe('70.00');
  });

  it('completes a supplied breakdown entry rather than replacing it', () => {
    const result = computeTotals(
      draft([line({ vatCategory: 'E', vatRate: 0 })], {
        taxBreakdown: [
          {
            category: 'E',
            rate: 0,
            exemptionReason: 'Exonération art. 262 ter I',
            exemptionReasonCode: 'VATEX-EU-IC',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.taxBreakdown[0]).toEqual({
      type: 'VAT',
      category: 'E',
      rate: '0',
      basisAmount: '100.00',
      calculatedAmount: '0.00',
      exemptionReason: 'Exonération art. 262 ter I',
      exemptionReasonCode: 'VATEX-EU-IC',
    });
  });

  it('groups one entry per category and rate, ordered by rate then category', () => {
    const result = computeTotals(
      draft([
        line({ id: '1', netPrice: 100, vatRate: 20 }),
        line({ id: '2', netPrice: 50, vatRate: 5.5 }),
        // Same category and rate as line 1: one entry, not two.
        line({ id: '3', netPrice: 30, vatRate: 20.0 }),
        line({ id: '4', netPrice: 10, vatCategory: 'Z', vatRate: 0 }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.taxBreakdown.map((tb) => [tb.category, tb.rate, tb.basisAmount])).toEqual([
      ['Z', '0', '10.00'],
      ['S', '5.5', '50.00'],
      ['S', '20', '130.00'],
    ]);
  });

  it('reports a figure the caller stated that the arithmetic disagrees with', () => {
    const result = computeTotals(draft([line({ netPrice: 100 })], { totals: { grandTotal: 999 } }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      {
        code: 'TOTALS_MISMATCH',
        field: 'totals.grandTotal',
        message: 'totals.grandTotal: stated 999.00, derived 120.00',
        given: '999',
        computed: '120.00',
      },
    ]);
  });

  it('reports a stated line amount and breakdown amount as well as the header totals', () => {
    const result = computeTotals(
      draft([line({ netPrice: 100, lineTotal: 111 })], {
        taxBreakdown: [{ category: 'S', rate: 20, basisAmount: 111, calculatedAmount: 22.2 }],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.field)).toEqual([
      'lines[0].lineTotal',
      'taxBreakdown[0].basisAmount',
      'taxBreakdown[0].calculatedAmount',
    ]);
  });

  it('reports a stated BT-107 that no allowance group backs (BR-CO-11)', () => {
    const result = computeTotals(draft([line({ netPrice: 100 })], { totals: { allowanceTotal: 20 } }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject([{ field: 'totals.allowanceTotal', given: '20', computed: '0' }]);
  });

  it('takes the computed figures with overwrite', () => {
    const result = computeTotals(draft([line({ netPrice: 100 })], { totals: { grandTotal: 999 } }), {
      overwrite: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.totals.grandTotal).toBe('120.00');
  });

  it('refuses to derive anything from an invoice with no lines', () => {
    const result = computeTotals(draft([]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject([{ code: 'NO_LINES', field: 'lines' }]);
  });

  it('refuses a breakdown entry that matches no line, allowance or charge', () => {
    const result = computeTotals(
      draft([line({ vatRate: 20 })], { taxBreakdown: [{ category: 'S', rate: 10 }] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject([{ code: 'ORPHAN_TAX_BREAKDOWN', field: 'taxBreakdown[0]' }]);
  });

  it('refuses two breakdown entries sharing a category and rate', () => {
    // Keyed on exactly that pair, so one would overwrite the other — and take
    // the exemption reason, which nothing can derive back, with it.
    const result = computeTotals(
      draft([line({ vatCategory: 'E', vatRate: 0 })], {
        taxBreakdown: [
          { category: 'E', rate: 0, exemptionReason: 'Exonération art. 262 ter I' },
          { category: 'E', rate: 0 },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject([
      { code: 'DUPLICATE_TAX_BREAKDOWN', field: 'taxBreakdown[1]' },
    ]);
  });

  it('accepts a stated BT-117 within a cent of the derived one', () => {
    // 99.99 at 5.5% is 5.49945: 5.50 here, 5.49 or 5.50 in a decimal system
    // depending on its rounding mode. Both are accepted by BR-CO-17 and by
    // validateEn16931, so neither is a disagreement worth refusing over.
    const result = computeTotals(
      draft([line({ netPrice: 33.33, quantity: 3, vatRate: 5.5 })], {
        taxBreakdown: [{ category: 'S', rate: 5.5, basisAmount: 99.99, calculatedAmount: 5.49 }],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Accepted, but the derived figure is still what lands in the document.
    expect(result.invoice.taxBreakdown[0]!.calculatedAmount).toBe('5.50');
  });

  it('accepts a complete, internally consistent set from a decimal-based caller', () => {
    // 53.50 at 5% is exactly 2.675: 2.68 half away from zero, which is what
    // this library now derives, but 2.67 from an implementation rounding the
    // float (2.675 is stored as 2.67499999…). Slacking BT-117 alone would be
    // pointless — the caller states the totals built on it too, and comparing
    // *those* exactly would refuse the whole document the Schematron accepts.
    const result = computeTotals(
      draft([line({ netPrice: 53.5, quantity: 1, vatRate: 5 })], {
        taxBreakdown: [{ category: 'S', rate: 5, basisAmount: 53.5, calculatedAmount: 2.67 }],
        totals: { lineTotal: 53.5, taxBasisTotal: 53.5, taxTotal: 2.67, grandTotal: 56.17, duePayable: 56.17 },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Accepted, but the derived figures are still what land in the document.
    expect(result.invoice.totals.taxTotal).toBe('2.68');
    expect(result.invoice.totals.grandTotal).toBe('56.18');
  });

  it('still reports a VAT-derived total off by more than a cent per group', () => {
    const result = computeTotals(
      draft([line({ netPrice: 53.5, quantity: 1, vatRate: 5 })], {
        totals: { grandTotal: 56.2 },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject([{ field: 'totals.grandTotal', given: '56.2', computed: '56.18' }]);
  });

  it('still reports a stated BT-117 that is off by more than a cent', () => {
    const result = computeTotals(
      draft([line({ netPrice: 33.33, quantity: 3, vatRate: 5.5 })], {
        taxBreakdown: [{ category: 'S', rate: 5.5, basisAmount: 99.99, calculatedAmount: 5.47 }],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject([
      { field: 'taxBreakdown[0].calculatedAmount', given: '5.47', computed: '5.50' },
    ]);
  });

  it('refuses a non-finite amount instead of propagating it into every total', () => {
    const result = computeTotals(draft([line({ netPrice: Number.NaN })]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject([
      { code: 'INVALID_DECIMAL', field: 'lines[0].netPrice' },
    ]);
  });

  it('reports the line amount it derived, not the one it was given', () => {
    const result = computeTotals(draft([line({ netPrice: 100, quantity: 2, lineTotal: 1 })]), {
      overwrite: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.lines[0]!.lineTotal).toBe('200.00');
    expect(result.invoice.totals.lineTotal).toBe('200.00');
  });
});
