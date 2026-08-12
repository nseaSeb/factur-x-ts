import { describe, expect, it } from 'vitest';
import { validateEn16931 } from '../../src/profiles/en16931.js';
import { sampleInvoice } from '../fixtures/invoice.js';

describe('validateEn16931', () => {
  it('accepts a well-formed invoice', () => {
    const result = validateEn16931(sampleInvoice());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an invoice with no lines', () => {
    const invoice = { ...sampleInvoice(), lines: [] };
    const result = validateEn16931(invoice);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'NO_LINES')).toBe(true);
  });

  it('rejects a standard-rate line with a 0% VAT rate', () => {
    const invoice = sampleInvoice();
    const invalid = { ...invoice, lines: [{ ...invoice.lines[0]!, vatRate: 0 }] };
    const result = validateEn16931(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_VAT_RATE')).toBe(true);
  });

  it('rejects a VAT breakdown that does not cover a line category/rate', () => {
    const invoice = sampleInvoice();
    const invalid = { ...invoice, taxBreakdown: [{ ...invoice.taxBreakdown[0]!, rate: 10 }] };
    const result = validateEn16931(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_TAX_BREAKDOWN_GROUP')).toBe(true);
  });

  it('rejects mismatched header totals', () => {
    const invoice = sampleInvoice();
    const invalid = { ...invoice, totals: { ...invoice.totals, grandTotal: 999 } };
    const result = validateEn16931(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'AMOUNT_MISMATCH' && e.field === 'totals.grandTotal')).toBe(true);
  });

  it('requires an exemption reason for VAT-exempt breakdown groups', () => {
    const invoice = sampleInvoice();
    const invalid = {
      ...invoice,
      lines: [{ ...invoice.lines[0]!, vatCategory: 'E' as const, vatRate: 0 }],
      allowances: undefined,
      taxBreakdown: [{ type: 'VAT' as const, category: 'E' as const, rate: 0, basisAmount: 200, calculatedAmount: 0 }],
      totals: { ...invoice.totals, allowanceTotal: undefined, taxBasisTotal: 200, taxTotal: 0, grandTotal: 200, duePayable: 200 },
    };
    const result = validateEn16931(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_EXEMPTION_REASON')).toBe(true);
  });

  it('requires the buyer VAT id for intra-community (K) supplies', () => {
    const invoice = sampleInvoice();
    const invalid = {
      ...invoice,
      lines: [{ ...invoice.lines[0]!, vatCategory: 'K' as const, vatRate: 0 }],
      allowances: undefined,
      taxBreakdown: [{ type: 'VAT' as const, category: 'K' as const, rate: 0, basisAmount: 200, calculatedAmount: 0 }],
      totals: { ...invoice.totals, allowanceTotal: undefined, taxBasisTotal: 200, taxTotal: 0, grandTotal: 200, duePayable: 200 },
    };
    const result = validateEn16931(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_BUYER_VAT_ID')).toBe(true);
  });

  it('rejects an allowanceTotal with no document-level allowance group behind it', () => {
    // BT-107 without a BG-20 group passes arithmetic but fails BR-CO-11 at the receiver.
    const invoice = sampleInvoice();
    const invalid = { ...invoice, allowances: undefined };
    const result = validateEn16931(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'AMOUNT_MISMATCH' && e.field === 'totals.allowanceTotal')).toBe(true);
  });

  it('rejects document-level allowances that do not sum to allowanceTotal', () => {
    const invoice = sampleInvoice();
    const invalid = { ...invoice, allowances: [{ ...invoice.allowances![0]!, amount: 12 }] };
    const result = validateEn16931(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'AMOUNT_MISMATCH' && e.field === 'totals.allowanceTotal')).toBe(true);
  });
});
