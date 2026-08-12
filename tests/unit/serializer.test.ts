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
