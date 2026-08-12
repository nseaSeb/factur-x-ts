// tests/fixtures/invoice.ts
// Shared EN 16931-valid sample invoice for unit and e2e tests.

import type { FacturXInvoice } from '../../src/types/index.js';

export function sampleInvoice(): FacturXInvoice {
  return {
    number: 'INV-2026-001',
    issueDate: new Date(Date.UTC(2026, 7, 9)),
    currency: 'EUR',
    typeCode: '380',
    businessProcess: 'S1',
    taxDueDateTypeCode: '5',
    seller: {
      name: 'Ma Société SARL',
      vatId: 'FR12345678901',
      address: {
        lineOne: '1 rue de la Paix',
        postcode: '75001',
        city: 'Paris',
        country: 'FR',
      },
      contact: { name: 'Jean Dupont', email: 'jean@example.com' },
    },
    buyer: {
      name: 'Client & Co "Spécial"',
      address: {
        lineOne: '2 avenue des Champs',
        postcode: '69000',
        city: 'Lyon',
        country: 'FR',
      },
    },
    lines: [
      {
        id: '1',
        name: 'Prestation <conseil>',
        quantity: 2,
        unit: 'C62',
        netPrice: 100,
        grossPrice: 120,
        priceDiscount: 20,
        lineTotal: 200,
        vatCategory: 'S',
        vatRate: 20,
      },
    ],
    // Document-level allowance (BG-20): this is what totals.allowanceTotal
    // (BT-107) is the sum of. A line-level allowance would instead be folded
    // into the line's own lineTotal and would NOT appear in allowanceTotal.
    allowances: [{ amount: 5, reason: 'Remise fidélité', vatCategory: 'S', vatRate: 20 }],
    taxBreakdown: [{ type: 'VAT', category: 'S', rate: 20, basisAmount: 195, calculatedAmount: 39 }],
    totals: {
      lineTotal: 200,
      allowanceTotal: 5,
      taxBasisTotal: 195,
      taxTotal: 39,
      grandTotal: 234,
      duePayable: 234,
    },
    notes: [{ content: 'Merci de votre confiance' }],
    precedingInvoices: [{ number: 'INV-2025-999', issueDate: new Date(Date.UTC(2025, 11, 1)) }],
  };
}

/**
 * Expected shape after a serialize -> deserialize round-trip.
 *
 * The top-level `taxDueDateTypeCode` (French-mandate BT-8 default) is folded
 * into each `taxBreakdown[].dueDateTypeCode` on serialize and is not
 * reconstructed at the top level on deserialize — the per-breakdown value is
 * the round-trip-stable representation. See src/xml/serializer.ts.
 */
export function expectedRoundTrip(invoice: FacturXInvoice): unknown {
  const { taxDueDateTypeCode, ...rest } = invoice;
  return {
    ...rest,
    taxBreakdown: invoice.taxBreakdown.map((tb) => ({
      ...tb,
      dueDateTypeCode: tb.dueDateTypeCode ?? taxDueDateTypeCode,
    })),
  };
}
