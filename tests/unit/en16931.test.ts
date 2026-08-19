import { describe, expect, it } from 'vitest';
import { validateEn16931 } from '../../src/profiles/en16931.js';
import { serialize } from '../../src/xml/serializer.js';
import { deserialize } from '../../src/xml/deserializer.js';
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

    it('rejects Object.prototype member names, which `in` would have admitted', () => {
      // Reachable from parsed third-party XML: qdt:TimeReferenceCodeType is an
      // unenumerated xs:token, so such a value passes the XSD.
      for (const code of ['toString', 'valueOf', 'hasOwnProperty']) {
        const result = validateEn16931({ ...sampleInvoice(), taxDueDateTypeCode: code });
        expect(result.errors.some((e) => e.code === 'INVALID_VAT_POINT_DATE'), code).toBe(true);
      }
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
      const result = validateEn16931(invoice, { validateFrenchRules: true });
      expect(result.errors.some((e) => e.code === 'INVALID_BUSINESS_PROCESS')).toBe(true);
    });

    it('keeps the G1.02 list closed against Object.prototype member names', () => {
      for (const code of ['constructor', 'valueOf', 'hasOwnProperty']) {
        const result = validateEn16931({ ...sampleInvoice(), businessProcess: code }, { validateFrenchRules: true });
        expect(result.errors.some((e) => e.code === 'INVALID_BUSINESS_PROCESS'), code).toBe(true);
      }
    });

    it('rejects a BT-8 present on only some breakdown groups (S1.13)', () => {
      // The likeliest real violation: one BG-23 carries ram:DueDateTypeCode and
      // the other does not, which S1.13 forbids as much as two different codes.
      const invoice = sampleInvoice();
      const partial = {
        ...invoice,
        taxDueDateTypeCode: undefined,
        taxBreakdown: [
          { ...invoice.taxBreakdown[0]!, dueDateTypeCode: '29' },
          { ...invoice.taxBreakdown[0]!, rate: 10 },
        ],
      };
      const result = validateEn16931(partial, { validateFrenchRules: true });
      const inconsistent = result.errors.find((e) => e.code === 'INCONSISTENT_VAT_POINT_DATE');

      expect(inconsistent).toBeDefined();
      expect(inconsistent?.message).toContain('(absent)');
    });

    it('requires the SIREN of both parties when enabled (BT-30 / BT-47)', () => {
      const base = sampleInvoice();
      const invoice = {
        ...base,
        seller: { ...base.seller, legalId: undefined },
        buyer: { ...base.buyer, legalId: undefined },
      };
      const errors = validateEn16931(invoice, { validateFrenchRules: true }).errors;

      expect(errors.filter((e) => e.code === 'MISSING_LEGAL_ID').map((e) => e.field)).toEqual([
        'seller.legalId',
        'buyer.legalId',
      ]);
    });

    it('does not require a SIREN by default', () => {
      const base = sampleInvoice();
      const invoice = { ...base, seller: { ...base.seller, legalId: undefined } };
      expect(validateEn16931(invoice).valid).toBe(true);
    });

    it('rejects a SIREN that is not 9 digits', () => {
      const base = sampleInvoice();
      const invoice = { ...base, seller: { ...base.seller, legalId: '1234' } };
      const result = validateEn16931(invoice, { validateFrenchRules: true });

      expect(result.errors.some((e) => e.code === 'INVALID_LEGAL_ID')).toBe(true);
    });

    it('does not check the digit shape under a non-SIRENE scheme', () => {
      // A party identified under another scheme legitimately carries something
      // that is not a SIREN.
      const base = sampleInvoice();
      const invoice = { ...base, seller: { ...base.seller, legalId: 'GB-12345', legalScheme: '0060' } };
      const result = validateEn16931(invoice, { validateFrenchRules: true });

      expect(result.errors.some((e) => e.code === 'INVALID_LEGAL_ID')).toBe(false);
    });

    it('requires BT-23 when enabled', () => {
      const invoice = { ...sampleInvoice(), businessProcess: undefined };
      const result = validateEn16931(invoice, { validateFrenchRules: true });
      expect(result.errors.some((e) => e.code === 'MISSING_BUSINESS_PROCESS')).toBe(true);
    });

    it('accepts the sample invoice, which carries S1', () => {
      expect(validateEn16931(sampleInvoice(), { validateFrenchRules: true }).valid).toBe(true);
    });

    it('rejects a down-payment type code under a final-invoice process (G1.60)', () => {
      const invoice = { ...sampleInvoice(), businessProcess: 'S4', typeCode: '386' as const };
      const result = validateEn16931(invoice, { validateFrenchRules: true });
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
      const result = validateEn16931(divergent, { validateFrenchRules: true });
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

  describe('BR-CO-25 — payment due date or terms when duePayable is positive', () => {
    it('rejects a positive duePayable with neither paymentDueDate nor paymentTerms', () => {
      const invoice = { ...sampleInvoice(), paymentTerms: undefined };
      const result = validateEn16931(invoice);
      expect(result.errors.some((e) => e.code === 'MISSING_PAYMENT_TERMS')).toBe(true);
    });

    it('accepts paymentDueDate alone, with no paymentTerms', () => {
      const invoice = { ...sampleInvoice(), paymentTerms: undefined, paymentDueDate: new Date(Date.UTC(2026, 8, 8)) };
      expect(validateEn16931(invoice).errors.some((e) => e.code === 'MISSING_PAYMENT_TERMS')).toBe(false);
    });

    it('does not require either field when duePayable is zero or negative', () => {
      const base = sampleInvoice();
      const invoice = {
        ...base,
        paymentTerms: undefined,
        totals: { ...base.totals, prepaid: base.totals.grandTotal, duePayable: 0 },
      };
      expect(validateEn16931(invoice).errors.some((e) => e.code === 'MISSING_PAYMENT_TERMS')).toBe(false);
    });

    it('does not require either field when duePayable is a float-noise epsilon above zero', () => {
      // grandTotal - prepaid landing on a tiny positive float instead of exact
      // 0 must count as "not positive" here the same way isClose treats it as
      // zero elsewhere in this file — a raw `duePayable <= 0` check would
      // disagree and raise a spurious BR-CO-25 error on a fully-paid invoice.
      const base = sampleInvoice();
      const invoice = {
        ...base,
        paymentTerms: undefined,
        totals: { ...base.totals, prepaid: base.totals.grandTotal - 3e-15, duePayable: 3e-15 },
      };
      expect(validateEn16931(invoice).errors.some((e) => e.code === 'MISSING_PAYMENT_TERMS')).toBe(false);
    });

    it('rejects an empty-string paymentTerms as if it were absent', () => {
      // An empty paymentTerms fails BR-CO-25 on the wire too: buildPaymentTerms
      // only emits ram:Description for a non-empty string, so the two must agree.
      const invoice = { ...sampleInvoice(), paymentTerms: '' };
      expect(validateEn16931(invoice).errors.some((e) => e.code === 'MISSING_PAYMENT_TERMS')).toBe(true);
    });
  });

  describe('BR-CO-17 — VAT category tax amount vs. basisAmount × rate / 100', () => {
    it('accepts a calculatedAmount within the 1-unit tolerance', () => {
      const invoice = sampleInvoice();
      // 195 × 20 / 100 = 39 exactly; 39.9 is still within the official ±1 slack.
      const invalid = { ...invoice, taxBreakdown: [{ ...invoice.taxBreakdown[0]!, calculatedAmount: 39.9 }] };
      expect(validateEn16931(invalid).errors.some((e) => e.field === 'taxBreakdown[0].calculatedAmount')).toBe(false);
    });

    it('rejects a calculatedAmount clearly outside the formula', () => {
      const invoice = sampleInvoice();
      const invalid = { ...invoice, taxBreakdown: [{ ...invoice.taxBreakdown[0]!, calculatedAmount: 100 }] };
      const result = validateEn16931(invalid);
      expect(result.errors.some((e) => e.field === 'taxBreakdown[0].calculatedAmount' && e.code === 'AMOUNT_MISMATCH')).toBe(true);
    });
  });

  describe('line-level allowances/charges reconciled against lineTotal', () => {
    it('accepts a line whose allowances/charges are reflected in lineTotal', () => {
      const base = sampleInvoice();
      const invoice = {
        ...base,
        lines: [
          {
            ...base.lines[0]!,
            // 100 × 2 - 15 (allowance) + 5 (charge) = 190
            allowances: [{ amount: 15, vatCategory: 'S' as const, vatRate: 20 }],
            charges: [{ amount: 5, vatCategory: 'S' as const, vatRate: 20 }],
            lineTotal: 190,
          },
        ],
      };
      expect(validateEn16931(invoice).errors.some((e) => e.field === 'lines[0].lineTotal')).toBe(false);
    });

    it('rejects a lineTotal that ignores its own allowances', () => {
      const base = sampleInvoice();
      const invoice = {
        ...base,
        lines: [
          {
            ...base.lines[0]!,
            allowances: [{ amount: 15, vatCategory: 'S' as const, vatRate: 20 }],
            // Should be 185 (200 - 15); left at 200 as if the allowance were ignored.
          },
        ],
      };
      const result = validateEn16931(invoice);
      expect(result.errors.some((e) => e.field === 'lines[0].lineTotal' && e.code === 'AMOUNT_MISMATCH')).toBe(true);
    });

    it('scales the tolerance by magnitude on a negative-quantity credit line, not just Math.max(1, quantity)', () => {
      // A raw `Math.max(1, quantity)` always floors to 1 for any negative
      // quantity, leaving a large-magnitude credit/return line under-tolerated
      // for the same beyond-4-decimal netPrice rounding drift as the positive
      // case (netPrice serializes at 4 decimals — see formatUnitPrice in
      // serializer.ts — so a 6-decimal price still drifts slightly).
      const base = sampleInvoice();
      const invoice = {
        ...base,
        lines: [{ ...base.lines[0]!, netPrice: 10.000567, grossPrice: undefined, priceDiscount: undefined, quantity: -3000, lineTotal: -30001.7 }],
      };

      const roundTripped = deserialize(serialize(invoice, 'EN 16931'));
      expect(roundTripped.lines[0]!.netPrice).toBe(10.0006); // rounded to 4 decimals, not truncated to 2

      const result = validateEn16931(roundTripped);
      expect(result.errors.some((e) => e.field === 'lines[0].lineTotal')).toBe(false);
    });

    it('tolerates the residual drift from a netPrice with more than 4 decimals surviving a serialize/deserialize round-trip', () => {
      // netPrice now serializes at 4 decimals (fixed — was 2, see README
      // history), so a 4-decimal-or-fewer price round-trips exactly. A price
      // carrying a 5th/6th decimal still drifts slightly; that residual drift
      // must not itself be flagged.
      const base = sampleInvoice();
      const invoice = {
        ...base,
        allowances: undefined,
        lines: [{ ...base.lines[0]!, netPrice: 10.000567, grossPrice: undefined, priceDiscount: undefined, quantity: 3, lineTotal: 30.0 }],
        taxBreakdown: [{ type: 'VAT' as const, category: 'S' as const, rate: 20, basisAmount: 30.0, calculatedAmount: 6 }],
        totals: { lineTotal: 30.0, taxBasisTotal: 30.0, taxTotal: 6, grandTotal: 36.0, duePayable: 36.0 },
      };

      const roundTripped = deserialize(serialize(invoice, 'EN 16931'));
      expect(roundTripped.lines[0]!.netPrice).toBe(10.0006); // confirms the (now much smaller) drift is really there

      const result = validateEn16931(roundTripped);
      expect(result.errors.some((e) => e.field === 'lines[0].lineTotal')).toBe(false);
    });
  });

  it('does not misreport a mismatch from float drift when several lines sum exactly at 2 decimals', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754 float, by about 5.5e-17 — comparing via
    // toFixed(2) (what actually goes on the wire) must absorb that, not reject
    // a document the real Schematron (decimal arithmetic, rounded once) accepts.
    const base = sampleInvoice();
    const invoice = {
      ...base,
      lines: [
        { ...base.lines[0]!, id: '1', netPrice: 0.1, quantity: 1, lineTotal: 0.1 },
        { ...base.lines[0]!, id: '2', netPrice: 0.2, quantity: 1, lineTotal: 0.2 },
      ],
      taxBreakdown: [{ type: 'VAT' as const, category: 'S' as const, rate: 20, basisAmount: 0.3, calculatedAmount: 0.06 }],
      totals: { ...base.totals, lineTotal: 0.3, taxBasisTotal: 0.3, taxTotal: 0.06, grandTotal: 0.36, duePayable: 0.36 },
    };

    const result = validateEn16931(invoice);
    expect(result.errors.some((e) => e.field === 'totals.lineTotal')).toBe(false);
  });

  it('does not misreport a mismatch when a subtraction chain lands on negative-epsilon instead of exact zero', () => {
    // lineTotal - allowanceTotal + chargeTotal = 0.02 - 0.05 + 0.03, which is
    // mathematically exactly 0 but evaluates to -3.469e-18 in IEEE 754 float.
    // (-3.469e-18).toFixed(2) is the string "-0.00", not "0.00" — even though
    // (-0).toFixed(2) IS "0.00" — so a naive toFixed comparison against an
    // exact 0 would report a false AMOUNT_MISMATCH on taxBasisTotal (BR-CO-13).
    const base = sampleInvoice();
    const invoice = {
      ...base,
      lines: [{ ...base.lines[0]!, netPrice: 0.02, quantity: 1, lineTotal: 0.02 }],
      allowances: [{ amount: 0.05, vatCategory: 'S' as const, vatRate: 20 }],
      charges: [{ amount: 0.03, vatCategory: 'S' as const, vatRate: 20 }],
      taxBreakdown: [{ type: 'VAT' as const, category: 'S' as const, rate: 20, basisAmount: 0, calculatedAmount: 0 }],
      totals: {
        lineTotal: 0.02,
        allowanceTotal: 0.05,
        chargeTotal: 0.03,
        taxBasisTotal: 0.02 - 0.05 + 0.03,
        taxTotal: 0,
        grandTotal: 0.02 - 0.05 + 0.03,
        duePayable: 0.02 - 0.05 + 0.03,
      },
    };

    const result = validateEn16931(invoice);
    expect(result.errors.some((e) => e.field === 'totals.taxBasisTotal')).toBe(false);
  });
});
