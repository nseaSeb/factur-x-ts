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

  describe('BT-8 — VAT point date (BR-CL-06)', () => {
    it('accepts the three CII codes', () => {
      for (const code of ['5', '29', '72']) {
        const result = validateEn16931({ ...sampleInvoice(), taxDueDateTypeCode: code });
        expect(result.valid, `code ${code}`).toBe(true);
      }
    });

    it('rejects UNTDID 2005 codes, which are valid in UBL only', () => {
      for (const code of ['3', '35', '432']) {
        const result = validateEn16931({ ...sampleInvoice(), taxDueDateTypeCode: code });
        expect(result.errors.some((e) => e.code === 'INVALID_VAT_POINT_DATE'), `code ${code}`).toBe(true);
      }
    });

    it('rejects an invalid code on a single breakdown entry', () => {
      const invoice = sampleInvoice();
      const invalid = {
        ...invoice,
        taxDueDateTypeCode: undefined,
        taxBreakdown: [{ ...invoice.taxBreakdown[0]!, dueDateTypeCode: '3' }],
      };
      expect(validateEn16931(invalid).errors.some((e) => e.field === 'taxBreakdown[0].dueDateTypeCode')).toBe(true);
    });

    it('can be switched off for the correct-a-received-invoice pipeline', () => {
      const invoice = { ...sampleInvoice(), taxDueDateTypeCode: '3' };
      expect(validateEn16931(invoice, { validateVatPointDate: false }).valid).toBe(true);
    });

    it('rejects a document-level code that has no breakdown group to live in', () => {
      const invoice = { ...sampleInvoice(), taxBreakdown: [] };
      const result = validateEn16931(invoice);
      expect(result.errors.some((e) => e.code === 'UNEMITTABLE_VAT_POINT_DATE')).toBe(true);
    });
  });

  describe('French reform rules (opt-in)', () => {
    it('does not apply the G1.02 closed list by default', () => {
      // BT-23 is unrestricted in EN 16931 — Peppol and Chorus Pro use other values.
      const invoice = { ...sampleInvoice(), businessProcess: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0' };
      expect(validateEn16931(invoice).valid).toBe(true);
    });

    it('rejects a business process outside the G1.02 list when enabled', () => {
      const invoice = { ...sampleInvoice(), businessProcess: 'X9' };
      const result = validateEn16931(invoice, { validateBusinessProcess: true });
      expect(result.errors.some((e) => e.code === 'INVALID_BUSINESS_PROCESS')).toBe(true);
    });

    it('requires BT-23 when enabled', () => {
      const invoice = { ...sampleInvoice(), businessProcess: undefined };
      const result = validateEn16931(invoice, { validateBusinessProcess: true });
      expect(result.errors.some((e) => e.code === 'MISSING_BUSINESS_PROCESS')).toBe(true);
    });

    it('accepts the sample invoice, which carries S1', () => {
      expect(validateEn16931(sampleInvoice(), { validateBusinessProcess: true }).valid).toBe(true);
    });

    it('rejects a down-payment type code under a final-invoice process (G1.60)', () => {
      const invoice = { ...sampleInvoice(), businessProcess: 'S4', typeCode: '386' as const };
      const result = validateEn16931(invoice, { validateBusinessProcess: true });
      expect(result.errors.some((e) => e.code === 'FORBIDDEN_TYPE_CODE_FOR_BUSINESS_PROCESS')).toBe(true);
    });

    it('rejects divergent BT-8 codes in one document (S1.13)', () => {
      const invoice = sampleInvoice();
      const divergent = {
        ...invoice,
        taxDueDateTypeCode: undefined,
        taxBreakdown: [
          { ...invoice.taxBreakdown[0]!, dueDateTypeCode: '29' },
          { ...invoice.taxBreakdown[0]!, dueDateTypeCode: '72' },
        ],
      };
      const result = validateEn16931(divergent, { validateBusinessProcess: true });
      expect(result.errors.some((e) => e.code === 'INCONSISTENT_VAT_POINT_DATE')).toBe(true);

      // The same document is fine under bare EN 16931.
      expect(validateEn16931(divergent).errors.some((e) => e.code === 'INCONSISTENT_VAT_POINT_DATE')).toBe(false);
    });
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
