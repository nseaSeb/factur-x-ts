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
      legalId: '123456789', // BT-30, SIREN
      legalScheme: '0002',
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
      legalId: '987654321', // BT-47, SIREN
      legalScheme: '0002',
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
 * BT-8 is *normalised*, not preserved verbatim: the serializer writes
 * `tb.dueDateTypeCode ?? invoice.taxDueDateTypeCode` onto every
 * `ram:ApplicableTradeTax`, and the deserializer lifts the value back to the
 * document level only when every entry agrees.
 *
 * So a round-trip is exact for the two canonical shapes — a document-level code
 * with no per-entry override, and no BT-8 at all — but not for the two mixed
 * ones, which are rewritten into their canonical equivalent:
 *
 * - a per-entry code with no document-level code is lifted to document level;
 * - a document-level code overridden by one entry is pushed down onto all
 *   entries, and the document-level field disappears.
 *
 * Both rewrites are semantically identical to their input. This helper models
 * them so that a future fixture of either shape does not read as a deserializer
 * bug. See normalizeVatPointDate in src/xml/deserializer.ts.
 */
export function expectedRoundTrip(invoice: FacturXInvoice): FacturXInvoice {
  const effective = invoice.taxBreakdown.map((tb) => tb.dueDateTypeCode ?? invoice.taxDueDateTypeCode);
  const distinct = new Set(effective);
  const uniform = effective.length > 0 && distinct.size === 1 && !distinct.has(undefined);

  if (uniform) {
    return {
      ...invoice,
      taxDueDateTypeCode: effective[0],
      taxBreakdown: invoice.taxBreakdown.map(({ dueDateTypeCode: _lifted, ...rest }) => rest),
    };
  }

  // Drop the key rather than set it to undefined: the deserializer omits it
  // entirely, and an explicit undefined would differ under deepStrictEqual.
  const { taxDueDateTypeCode: _pushedDown, ...withoutDocumentCode } = invoice;
  return {
    ...withoutDocumentCode,
    taxBreakdown: invoice.taxBreakdown.map((tb, index) => ({
      ...tb,
      ...(effective[index] !== undefined ? { dueDateTypeCode: effective[index] } : {}),
    })),
  };
}
