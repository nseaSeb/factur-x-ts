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
    paymentTerms: '30 jours net',
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

/**
 * Every field the model carries, on one invoice.
 *
 * `sampleInvoice` is deliberately ordinary, which makes it blind to a field
 * that no profile-gating covers: serializing it at BASIC was XSD-clean while
 * `ram:Description` was ungated, simply because it has no line description.
 * The per-profile XSD check runs against this one instead.
 *
 * The amounts are not arithmetically consistent and are not meant to be — this
 * exists for structural checks, not business rules.
 */
export function maximalInvoice(): FacturXInvoice {
  const base = sampleInvoice();
  return {
    ...base,
    taxRepresentative: {
      name: 'Représentant Fiscal SAS',
      vatId: 'FR99999999999',
      address: { lineOne: '9 rue du Fisc', postcode: '75009', city: 'Paris', country: 'FR' },
    },
    seller: { ...base.seller, globalId: '123456789', globalScheme: '0231' },
    buyer: {
      ...base.buyer,
      vatId: 'FR98765432109',
      contact: { name: 'Marie Martin', phone: '+33123456789', email: 'marie@example.com' },
    },
    notes: [{ content: 'Escompte 2% sous 8 jours', subjectCode: 'AAB' }],
    billingPeriod: { startDate: new Date(Date.UTC(2026, 6, 1)), endDate: new Date(Date.UTC(2026, 6, 31)) },
    paymentDueDate: new Date(Date.UTC(2026, 8, 8)),
    paymentMeans: [
      {
        typeCode: '58',
        iban: 'FR7630006000011234567890189',
        accountName: 'ACME SARL',
        bic: 'BNPAFRPPXXX',
        payerIban: 'FR7630006000011234567890190',
        cardId: '123456',
        cardholderName: 'JEAN DUPONT',
      },
    ],
    charges: [{ amount: 3, reason: 'Frais de port', reasonCode: 'FC', vatCategory: 'S', vatRate: 20 }],
    lines: [
      {
        ...base.lines[0]!,
        description: 'Conseil stratégique, forfait mensuel',
        notes: [{ content: 'Livré en deux temps', subjectCode: 'AAI' }],
        shipTo: {
          name: 'Entrepôt Nord',
          address: { lineOne: '5 quai du Nord', postcode: '59000', city: 'Lille', country: 'FR' },
        },
        deliveryDate: new Date(Date.UTC(2026, 7, 1)),
        precedingInvoice: { number: 'INV-2025-998', issueDate: new Date(Date.UTC(2025, 10, 1)) },
        allowances: [{ amount: 2, reason: 'Geste commercial', vatCategory: 'S', vatRate: 20 }],
        charges: [{ amount: 1, reason: 'Emballage', vatCategory: 'S', vatRate: 20 }],
      },
    ],
    taxBreakdown: [
      {
        ...base.taxBreakdown[0]!,
        exemptionReason: undefined,
      },
    ],
    totals: { ...base.totals, chargeTotal: 3, prepaid: 50 },
  };
}
