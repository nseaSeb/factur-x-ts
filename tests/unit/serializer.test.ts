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

  it('formats amounts with exactly 2 decimals', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    expect(xml).toContain('<ram:GrandTotalAmount>234.00</ram:GrandTotalAmount>');
    expect(xml).not.toMatch(/\d+e[+-]\d+/i);
  });

  it('formats netPrice/grossPrice/priceDiscount at 4 decimals, not 2', () => {
    // BT-146/BT-147/BT-148 have no Schematron-enforced decimal cap (unlike
    // the money totals above) — truncating to 2 decimals lost real precision
    // (a per-liter fuel price, for instance) and broke quantity × netPrice
    // reconciling with lineTotal for anything more precise than a cent.
    const base = sampleInvoice();
    const invoice = {
      ...base,
      lines: [{ ...base.lines[0]!, netPrice: 10.0006, grossPrice: 12.0007, priceDiscount: 2.0001 }],
    };
    const xml = serialize(invoice, 'EN 16931');

    expect(xml).toContain('<ram:NetPriceProductTradePrice><ram:ChargeAmount>10.0006</ram:ChargeAmount></ram:NetPriceProductTradePrice>');
    expect(xml).toContain('<ram:ChargeAmount>12.0007</ram:ChargeAmount>');
    expect(xml).toContain('<ram:ActualAmount>2.0001</ram:ActualAmount>');
    // The line's own monetary total is unaffected — still exactly 2 decimals.
    expect(xml).toContain('<ram:LineTotalAmount>200.00</ram:LineTotalAmount>');
  });

  it('carries currencyID only on ram:TaxTotalAmount, matching InvoiceCurrencyCode', () => {
    // The EN 16931 Schematron rejects @currencyID on every other ram:*Amount
    // element ("attribute not used in the given context") — it's implicitly
    // InvoiceCurrencyCode everywhere else. TaxTotalAmount alone is permitted
    // (and required) to carry it, to disambiguate a VAT total optionally
    // expressed in a second, accounting currency (BT-111) — which this
    // library doesn't support, so it always equals the invoice currency.
    const xml = serialize(sampleInvoice(), 'EN 16931');
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">39.00</ram:TaxTotalAmount>');
    expect(xml.match(/currencyID="[^"]*"/g)).toEqual(['currencyID="EUR"']);
  });

  it('escapes special XML characters', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    expect(xml).toContain('Prestation &lt;conseil&gt;');
    expect(xml).toContain('Client &amp; Co &quot;Spécial&quot;');
  });

  it('emits document-level allowances as a BG-20 group backing BT-107', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');

    expect(xml).toContain('<ram:AllowanceTotalAmount>5.00</ram:AllowanceTotalAmount>');
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

  it('strips C0 control characters instead of passing them through', () => {
    // XML 1.0 only permits Tab/LF/CR among the C0 controls — anything else in
    // free text (a copy-pasted form-feed, a stray NUL) is not valid character
    // data even escaped, so it must be dropped rather than break well-formedness.
    const base = sampleInvoice();
    const invoice = { ...base, lines: [{ ...base.lines[0]!, name: 'Bad\x00Name\x0Bwith\x1Fcontrols' }] };

    const xml = serialize(invoice, 'EN 16931');
    expect(xml).toContain('<ram:Name>BadNamewithcontrols</ram:Name>');
  });

  it('emits ram:SpecifiedTradePaymentTerms between the allowance/charge group and the monetary summation', () => {
    const invoice = { ...sampleInvoice(), paymentTerms: '30 jours net' };
    const xml = serialize(invoice, 'EN 16931');

    expect(xml).toContain('<ram:SpecifiedTradePaymentTerms><ram:Description>30 jours net</ram:Description></ram:SpecifiedTradePaymentTerms>');
    const settlement = xml.slice(xml.indexOf('<ram:ApplicableHeaderTradeSettlement>'));
    expect(settlement.indexOf('<ram:SpecifiedTradeAllowanceCharge>')).toBeLessThan(
      settlement.indexOf('<ram:SpecifiedTradePaymentTerms>'),
    );
    expect(settlement.indexOf('<ram:SpecifiedTradePaymentTerms>')).toBeLessThan(
      settlement.indexOf('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>'),
    );
  });

  it('omits ram:SpecifiedTradePaymentTerms when neither BT-9 nor BT-20 is given', () => {
    const invoice = { ...sampleInvoice(), paymentTerms: undefined };
    expect(serialize(invoice, 'EN 16931')).not.toContain('SpecifiedTradePaymentTerms');
  });

  it('omits ram:SpecifiedTradePaymentTerms for an empty-string paymentTerms too', () => {
    // A childless <ram:SpecifiedTradePaymentTerms/> would satisfy neither
    // ram:Description nor ram:DueDateDateTime, which is what BR-CO-25's own
    // XPath looks for — so an empty string must behave like "absent", not
    // like a present-but-blank value.
    const invoice = { ...sampleInvoice(), paymentTerms: '' };
    expect(serialize(invoice, 'EN 16931')).not.toContain('SpecifiedTradePaymentTerms');
  });

  it('emits a country-only address, omitting the elements not given', () => {
    // Only ram:CountryID is mandatory in the CII schema and in EN 16931's own
    // Schematron (BR-8/BR-10/BR-12: PostalTradeAddress/CountryID, never
    // Postcode/LineOne/City) — confirmed by reading both.
    const base = sampleInvoice();
    const invoice = { ...base, buyer: { ...base.buyer, address: { country: 'FR' } } };
    const xml = serialize(invoice, 'EN 16931');

    const buyer = xml.slice(xml.indexOf('<ram:BuyerTradeParty>'), xml.indexOf('</ram:BuyerTradeParty>'));
    expect(buyer).toContain('<ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>');
    expect(buyer).not.toContain('PostcodeCode');
    expect(buyer).not.toContain('LineOne');
    expect(buyer).not.toContain('CityName');
  });
});

describe('EXTENDED-only line fields (EXT-FR-FE-*)', () => {
  // French extensions on top of EN 16931 that only EXTENDED's XSD admits —
  // mirrors Facturx.CII.line_notes/line_ship_to/line_delivery_event/
  // line_preceding_invoice in the Elixir sibling: the profile decides what's
  // emitted, not the caller, so setting these fields on a non-EXTENDED
  // invoice is not an error, it's just silently dropped at serialize time.
  function lineWithExtras(base: ReturnType<typeof sampleInvoice>) {
    return {
      ...base.lines[0]!,
      notes: [
        { content: 'first', subjectCode: 'AAI' },
        { content: 'second', subjectCode: 'AAJ' },
      ],
      shipTo: {
        name: 'Entrepôt Nord',
        address: { lineOne: '9 rue du Port', postcode: '59000', city: 'Lille', country: 'FR' },
      },
      deliveryDate: new Date(Date.UTC(2026, 7, 15)),
      precedingInvoice: { number: 'INV-2026-LINE-REF' },
    };
  }

  it('emits every note with its SubjectCode only under EXTENDED', () => {
    const base = sampleInvoice();
    const invoice = { ...base, lines: [lineWithExtras(base)] };
    const xml = serialize(invoice, 'EXTENDED');

    expect(xml).toContain('<ram:IncludedNote><ram:Content>first</ram:Content><ram:SubjectCode>AAI</ram:SubjectCode></ram:IncludedNote>');
    expect(xml).toContain('<ram:IncludedNote><ram:Content>second</ram:Content><ram:SubjectCode>AAJ</ram:SubjectCode></ram:IncludedNote>');
  });

  it('emits only the first note, content-only, under EN 16931', () => {
    // EN 16931's XSD caps IncludedNote at one occurrence with no SubjectCode
    // (EXT-FR-FE-183) — a second note or a SubjectCode there is invalid.
    const base = sampleInvoice();
    const invoice = { ...base, lines: [lineWithExtras(base)] };
    const xml = serialize(invoice, 'EN 16931');

    expect(xml).toContain('<ram:IncludedNote><ram:Content>first</ram:Content></ram:IncludedNote>');
    expect(xml).not.toContain('second');
    expect(xml).not.toContain('SubjectCode');
  });

  it('emits line-level ShipToTradeParty and ActualDeliverySupplyChainEvent only under EXTENDED, in schema order', () => {
    const base = sampleInvoice();
    const invoice = { ...base, lines: [lineWithExtras(base)] };
    const extended = serialize(invoice, 'EXTENDED');

    expect(extended).toContain('<ram:ShipToTradeParty>');
    expect(extended).toContain('Entrepôt Nord');
    expect(extended).toContain('<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">20260815</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>');

    // LineTradeDeliveryType sequence: BilledQuantity, ShipToTradeParty, ActualDeliverySupplyChainEvent.
    const delivery = extended.slice(extended.indexOf('<ram:SpecifiedLineTradeDelivery>'));
    expect(delivery.indexOf('<ram:BilledQuantity')).toBeLessThan(delivery.indexOf('<ram:ShipToTradeParty>'));
    expect(delivery.indexOf('<ram:ShipToTradeParty>')).toBeLessThan(delivery.indexOf('<ram:ActualDeliverySupplyChainEvent>'));

    const en16931 = serialize(invoice, 'EN 16931');
    expect(en16931).not.toContain('ShipToTradeParty');
    expect(en16931).not.toContain('ActualDeliverySupplyChainEvent');
  });

  it('emits line-level InvoiceReferencedDocument only under EXTENDED, after the line monetary summation', () => {
    const base = sampleInvoice();
    const invoice = { ...base, lines: [lineWithExtras(base)] };
    const extended = serialize(invoice, 'EXTENDED');

    expect(extended).toContain('<ram:IssuerAssignedID>INV-2026-LINE-REF</ram:IssuerAssignedID>');
    // LineTradeSettlementType sequence: ..., the summation, THEN InvoiceReferencedDocument.
    const settlement = extended.slice(extended.lastIndexOf('<ram:SpecifiedLineTradeSettlement>'));
    expect(settlement.indexOf('<ram:SpecifiedTradeSettlementLineMonetarySummation>')).toBeLessThan(
      settlement.indexOf('<ram:InvoiceReferencedDocument>'),
    );

    expect(serialize(invoice, 'EN 16931')).not.toContain('INV-2026-LINE-REF');
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

  it('round-trips BT-9 (paymentDueDate) and BT-20 (paymentTerms) together', () => {
    const invoice = {
      ...sampleInvoice(),
      paymentTerms: '30 jours net',
      paymentDueDate: new Date(Date.UTC(2026, 8, 8)),
    };

    const roundTripped = deserialize(serialize(invoice, 'EN 16931'));
    expect(roundTripped.paymentTerms).toBe('30 jours net');
    expect(roundTripped.paymentDueDate).toEqual(new Date(Date.UTC(2026, 8, 8)));
  });

  it('round-trips the EXTENDED-only line fields (notes, shipTo, deliveryDate, precedingInvoice) under EXTENDED', () => {
    const base = sampleInvoice();
    const invoice = {
      ...base,
      lines: [
        {
          ...base.lines[0]!,
          notes: [{ content: 'first', subjectCode: 'AAI' }],
          shipTo: {
            name: 'Entrepôt Nord',
            address: { lineOne: '9 rue du Port', postcode: '59000', city: 'Lille', country: 'FR' },
          },
          deliveryDate: new Date(Date.UTC(2026, 7, 15)),
          precedingInvoice: { number: 'INV-2026-LINE-REF' },
        },
      ],
    };

    const roundTripped = deserialize(serialize(invoice, 'EXTENDED'));
    expect(roundTripped.lines[0]!.notes).toEqual([{ content: 'first', subjectCode: 'AAI' }]);
    expect(roundTripped.lines[0]!.shipTo).toEqual(invoice.lines[0].shipTo);
    expect(roundTripped.lines[0]!.deliveryDate).toEqual(new Date(Date.UTC(2026, 7, 15)));
    expect(roundTripped.lines[0]!.precedingInvoice).toEqual({ number: 'INV-2026-LINE-REF' });
  });

  it('drops the EXTENDED-only line fields under EN 16931, without erroring', () => {
    const base = sampleInvoice();
    const invoice = {
      ...base,
      lines: [
        {
          ...base.lines[0]!,
          notes: [{ content: 'first', subjectCode: 'AAI' }],
          shipTo: {
            name: 'Entrepôt Nord',
            address: { lineOne: '9 rue du Port', postcode: '59000', city: 'Lille', country: 'FR' },
          },
          deliveryDate: new Date(Date.UTC(2026, 7, 15)),
          precedingInvoice: { number: 'INV-2026-LINE-REF' },
        },
      ],
    };

    const roundTripped = deserialize(serialize(invoice, 'EN 16931'));
    // Content-only, no SubjectCode — the one note EN 16931's XSD leaves room for.
    expect(roundTripped.lines[0]!.notes).toEqual([{ content: 'first' }]);
    expect(roundTripped.lines[0]!.shipTo).toBeUndefined();
    expect(roundTripped.lines[0]!.deliveryDate).toBeUndefined();
    expect(roundTripped.lines[0]!.precedingInvoice).toBeUndefined();
  });

  it('round-trips a country-only address without fabricating the other fields', () => {
    const base = sampleInvoice();
    const invoice = { ...base, buyer: { ...base.buyer, address: { country: 'FR' } } };

    const roundTripped = deserialize(serialize(invoice, 'EN 16931'));
    expect(roundTripped.buyer.address).toEqual({ country: 'FR' });
  });
});
