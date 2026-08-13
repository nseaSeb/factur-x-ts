import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import { deserialize } from '../../src/xml/deserializer.js';
import { sampleInvoice, expectedRoundTrip } from '../fixtures/invoice.js';

describe('serialize', () => {
  it('emits the EN 16931 guideline ID and root namespaces', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"');
    expect(xml).toContain('xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"');
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
  });

  it('formats dates as YYYYMMDD with format="102"', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    expect(xml).toContain('<udt:DateTimeString format="102">20260809</udt:DateTimeString>');
  });

  it('formats amounts with exactly 2 decimals and a currencyID', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    expect(xml).toContain('<ram:GrandTotalAmount currencyID="EUR">234.00</ram:GrandTotalAmount>');
    expect(xml).not.toMatch(/\d+e[+-]\d+/i);
  });

  it('escapes special XML characters', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    expect(xml).toContain('Prestation &lt;conseil&gt;');
    expect(xml).toContain('Client &amp; Co &quot;Spécial&quot;');
  });

  it('emits document-level allowances as a BG-20 group backing BT-107', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');

    expect(xml).toContain('<ram:AllowanceTotalAmount currencyID="EUR">5.00</ram:AllowanceTotalAmount>');
    expect(xml).toContain('<ram:Reason>Remise fidélité</ram:Reason>');
    // The group must sit between BillingSpecifiedPeriod and the monetary
    // summation; nothing here validates against an XSD, so assert the order.
    const settlement = xml.slice(xml.indexOf('<ram:ApplicableHeaderTradeSettlement>'));
    expect(settlement.indexOf('<ram:SpecifiedTradeAllowanceCharge>')).toBeLessThan(
      settlement.indexOf('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>'),
    );
  });

  it('maps the correct guideline URN per profile', () => {
    expect(serialize(sampleInvoice(), 'MINIMUM')).toContain('urn:factur-x.eu:1p0:minimum');
    expect(serialize(sampleInvoice(), 'BASIC WL')).toContain('urn:factur-x.eu:1p0:basicwl');
    expect(serialize(sampleInvoice(), 'EXTENDED')).toContain('urn:factur-x.eu:1p0:extended');
  });
});

describe('serialize + deserialize round-trip', () => {
  it('reproduces the original invoice', () => {
    const invoice = sampleInvoice();
    const xml = serialize(invoice, 'EN 16931');
    const roundTripped = deserialize(xml);

    expect(roundTripped).toEqual(expectedRoundTrip(invoice));
  });

  it('keeps line-level and document-level allowances and charges apart', () => {
    const base = sampleInvoice();
    const invoice = {
      ...base,
      lines: [
        {
          ...base.lines[0]!,
          allowances: [{ amount: 3, reason: 'Remise ligne', vatCategory: 'S' as const, vatRate: 20 }],
          charges: [{ amount: 4, reason: 'Frais ligne', vatCategory: 'S' as const, vatRate: 20 }],
        },
      ],
      // base.allowances is the 5.00 document-level allowance (BT-107).
      charges: [{ amount: 10, reason: 'Frais de port', vatCategory: 'S' as const, vatRate: 20 }],
      taxBreakdown: [{ type: 'VAT' as const, category: 'S' as const, rate: 20, basisAmount: 205, calculatedAmount: 41 }],
      totals: { ...base.totals, chargeTotal: 10, taxBasisTotal: 205, taxTotal: 41, grandTotal: 246, duePayable: 246 },
    };

    const roundTripped = deserialize(serialize(invoice, 'EN 16931'));

    // Both levels survive without bleeding into each other, and the
    // ChargeIndicator=true branch is exercised at each level.
    expect(roundTripped).toEqual(expectedRoundTrip(invoice));
  });

  it('lifts a uniform BT-8 back to the document level', () => {
    const invoice = sampleInvoice(); // taxDueDateTypeCode: '5', one breakdown
    const roundTripped = deserialize(serialize(invoice, 'EN 16931'));

    expect(roundTripped.taxDueDateTypeCode).toBe('5');
    expect(roundTripped.taxBreakdown[0]).not.toHaveProperty('dueDateTypeCode');
  });

  it('keeps divergent BT-8 codes per entry instead of collapsing them', () => {
    // EN 16931 allows differing codes per breakdown; only the French rule S1.13
    // forbids it. Collapsing "29, 72" into "29, 29" would silently falsify the
    // VAT point date of the second entry.
    const base = sampleInvoice();
    const invoice = {
      ...base,
      taxDueDateTypeCode: undefined,
      taxBreakdown: [
        { type: 'VAT' as const, category: 'S' as const, rate: 20, basisAmount: 100, calculatedAmount: 20, dueDateTypeCode: '29' },
        { type: 'VAT' as const, category: 'S' as const, rate: 10, basisAmount: 95, calculatedAmount: 9.5, dueDateTypeCode: '72' },
      ],
    };

    const roundTripped = deserialize(serialize(invoice, 'EN 16931'));

    expect(roundTripped.taxDueDateTypeCode).toBeUndefined();
    expect(roundTripped.taxBreakdown.map((tb) => tb.dueDateTypeCode)).toEqual(['29', '72']);
  });

  it.each([
    ['document-level code only', (i: ReturnType<typeof sampleInvoice>) => i],
    [
      'no BT-8 at all',
      (i: ReturnType<typeof sampleInvoice>) => ({ ...i, taxDueDateTypeCode: undefined }),
    ],
    [
      'per-entry code only, lifted to document level',
      (i: ReturnType<typeof sampleInvoice>) => ({
        ...i,
        taxDueDateTypeCode: undefined,
        taxBreakdown: [{ ...i.taxBreakdown[0]!, dueDateTypeCode: '29' }],
      }),
    ],
    [
      'document-level code overridden by one entry, pushed down',
      (i: ReturnType<typeof sampleInvoice>) => ({
        ...i,
        taxDueDateTypeCode: '5',
        taxBreakdown: [
          { ...i.taxBreakdown[0]!, dueDateTypeCode: '29' },
          { ...i.taxBreakdown[0]!, rate: 10, basisAmount: 0, calculatedAmount: 0 },
        ],
      }),
    ],
  ])('normalises BT-8 predictably: %s', (_label, shape) => {
    const invoice = shape(sampleInvoice());
    expect(deserialize(serialize(invoice, 'EN 16931'))).toEqual(expectedRoundTrip(invoice));
  });

  it('round-trips SIREN identifiers on both parties', () => {
    const roundTripped = deserialize(serialize(sampleInvoice(), 'EN 16931'));

    expect(roundTripped.seller.legalId).toBe('123456789');
    expect(roundTripped.seller.legalScheme).toBe('0002');
    expect(roundTripped.buyer.legalId).toBe('987654321');
  });

  it('defaults the SIREN scheme to 0002 and returns it materialised', () => {
    const base = sampleInvoice();
    const invoice = { ...base, seller: { ...base.seller, legalScheme: undefined } };

    const xml = serialize(invoice, 'EN 16931');
    expect(xml).toContain('<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">123456789</ram:ID>');

    // The document is unchanged by the default; the model comes back enriched
    // with what the document actually says.
    expect(deserialize(xml).seller.legalScheme).toBe('0002');
  });

  it('defaults the GlobalID scheme to 0231 on the seller only', () => {
    const base = sampleInvoice();
    const invoice = {
      ...base,
      seller: { ...base.seller, globalId: '111222333' },
      buyer: { ...base.buyer, globalId: '3401234567890' }, // a GLN, not a SIREN
    };

    const xml = serialize(invoice, 'EN 16931');
    expect(xml).toContain('<ram:GlobalID schemeID="0231">111222333</ram:GlobalID>');
    expect(xml).toContain('<ram:GlobalID>3401234567890</ram:GlobalID>');

    const back = deserialize(xml);
    expect(back.seller.globalScheme).toBe('0231');
    expect(back.buyer.globalScheme).toBeUndefined();
  });

  it('places party identifiers in CII sequence order', () => {
    const base = sampleInvoice();
    const invoice = { ...base, seller: { ...base.seller, globalId: '111222333' } };
    const seller = serialize(invoice, 'EN 16931').split('<ram:SellerTradeParty>')[1]!;

    // TradePartyType: GlobalID, Name, SpecifiedLegalOrganization, contact,
    // address, SpecifiedTaxRegistration. Nothing validates this without an XSD.
    const order = ['<ram:GlobalID', '<ram:Name>', '<ram:SpecifiedLegalOrganization>', '<ram:PostalTradeAddress>'].map(
      (tag) => seller.indexOf(tag),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('round-trips the seller tax representative (BG-11)', () => {
    const base = sampleInvoice();
    const invoice = {
      ...base,
      taxRepresentative: {
        name: 'Représentant Fiscal SAS',
        vatId: 'FR99887766554',
        address: { lineOne: '9 rue Fiscale', postcode: '75002', city: 'Paris', country: 'FR' },
      },
    };

    const roundTripped = deserialize(serialize(invoice, 'EN 16931'));
    expect(roundTripped.taxRepresentative?.vatId).toBe('FR99887766554');
    expect(roundTripped.taxRepresentative?.name).toBe('Représentant Fiscal SAS');
  });

  it('handles an invoice with only mandatory fields', () => {
    const minimal = {
      number: 'INV-MIN-1',
      issueDate: new Date(Date.UTC(2026, 0, 1)),
      currency: 'EUR' as const,
      typeCode: '380' as const,
      seller: { name: 'Seller', address: { lineOne: 'A', postcode: '00000', city: 'City', country: 'FR' } },
      buyer: { name: 'Buyer', address: { lineOne: 'B', postcode: '11111', city: 'Town', country: 'FR' } },
      lines: [
        {
          id: '1',
          name: 'Item',
          quantity: 1,
          unit: 'C62',
          netPrice: 10,
          lineTotal: 10,
          vatCategory: 'S' as const,
          vatRate: 20,
        },
      ],
      taxBreakdown: [{ type: 'VAT' as const, category: 'S' as const, rate: 20, basisAmount: 10, calculatedAmount: 2 }],
      totals: { lineTotal: 10, taxBasisTotal: 10, taxTotal: 2, grandTotal: 12, duePayable: 12 },
    };

    const roundTripped = deserialize(serialize(minimal, 'EN 16931'));
    expect(roundTripped).toEqual(minimal);
  });
});
