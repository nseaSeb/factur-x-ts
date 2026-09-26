// The fields brought over from the Elixir sibling: BT-6/BT-111, BG-13/BT-72,
// BG-26, BT-39, BT-82, BT-84 (non-IBAN), BT-114, and open code lists.

import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import { deserialize, FacturXDeserializeError } from '../../src/xml/deserializer.js';
import { computeTotals } from '../../src/totals.js';
import { validateEn16931 } from '../../src/profiles/en16931.js';
import { validateSchematron } from '../../src/validate/schematron.js';
import { generate, FacturXGenerateError } from '../../src/pdf/generator.js';
import { atLeast } from '../../src/types/profiles.js';
import type { DraftInvoice, Profile } from '../../src/types/index.js';
import { maximalInvoice, sampleInvoice } from '../fixtures/invoice.js';

const PROFILES: readonly Profile[] = ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED'];

describe('each new field is written from its profile floor, and not below', () => {
  const cases: readonly [string, Profile, string][] = [
    ['BT-6 tax currency', 'BASIC WL', '<ram:TaxCurrencyCode>USD</ram:TaxCurrencyCode>'],
    ['BT-111 tax total in tax currency', 'BASIC WL', '<ram:TaxTotalAmount currencyID="USD">42.12</ram:TaxTotalAmount>'],
    ['BG-13 ship-to', 'BASIC WL', '<ram:ShipToTradeParty><ram:GlobalID schemeID="0088">3012345000019</ram:GlobalID>'],
    ['BT-72 delivery date', 'BASIC WL', '<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">20260715'],
    ['BT-39 country subdivision', 'BASIC WL', '<ram:CountrySubDivisionName>Île-de-France</ram:CountrySubDivisionName>'],
    ['BT-84 non-IBAN account', 'BASIC WL', '<ram:ProprietaryID>ACC-42</ram:ProprietaryID>'],
    ['BG-26 line period', 'BASIC', '<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">20260701</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">20260715'],
    ['BT-82 payment information', 'EN 16931', '<ram:Information>Virement SEPA</ram:Information>'],
    ['BT-114 rounding', 'EN 16931', '<ram:RoundingAmount>0.01</ram:RoundingAmount>'],
  ];

  it.each(cases)('%s from %s', (_name, floor, fragment) => {
    const floorIndex = PROFILES.indexOf(floor);
    PROFILES.forEach((profile, index) => {
      const xml = serialize(maximalInvoice(), profile);
      expect(xml.includes(fragment), `${profile}`).toBe(index >= floorIndex);
    });
  });
});

describe('the new fields read back', () => {
  it('at EXTENDED, where every one of them is written', () => {
    const source = maximalInvoice();
    const parsed = deserialize(serialize(source, 'EXTENDED'));

    expect(parsed.taxCurrency).toBe('USD');
    expect(parsed.totals.taxTotalInTaxCurrency).toBe('42.12');
    expect(parsed.totals.taxTotal).toBe('39.00');
    expect(parsed.totals.rounding).toBe('0.01');
    expect(parsed.shipTo).toEqual({
      name: 'Site client',
      globalId: '3012345000019',
      globalScheme: '0088',
      address: { lineOne: '1 rue du Site', postcode: '69001', city: 'Lyon', country: 'FR', countrySubdivision: 'Rhône' },
    });
    expect(parsed.deliveryDate).toEqual(new Date(Date.UTC(2026, 6, 15)));
    expect(parsed.seller.address?.countrySubdivision).toBe('Île-de-France');
    expect(parsed.paymentMeans?.[0]).toMatchObject({ information: 'Virement SEPA', accountId: 'ACC-42' });
    expect(parsed.lines[0]!.billingPeriod).toEqual(source.lines[0]!.billingPeriod);
  });

  it('tells BT-110 and BT-111 apart by currency, whatever their order', () => {
    const xml = serialize(maximalInvoice(), 'EN 16931');
    const swapped = xml.replace(
      /(<ram:TaxTotalAmount currencyID="EUR">[^<]*<\/ram:TaxTotalAmount>)(<ram:TaxTotalAmount currencyID="USD">[^<]*<\/ram:TaxTotalAmount>)/,
      '$2$1',
    );
    expect(swapped).not.toBe(xml);
    const parsed = deserialize(swapped);
    expect(parsed.totals.taxTotal).toBe('39.00');
    expect(parsed.totals.taxTotalInTaxCurrency).toBe('42.12');
  });

  it('writes a ship-to with only what BG-13 carries', () => {
    const base = sampleInvoice();
    const xml = serialize({ ...base, shipTo: { name: 'Dépôt', vatId: 'FR00000000000', legalId: '123456789' } }, 'EN 16931');
    const shipTo = /<ram:ShipToTradeParty>.*?<\/ram:ShipToTradeParty>/.exec(xml)?.[0];
    expect(shipTo).toBe('<ram:ShipToTradeParty><ram:Name>Dépôt</ram:Name></ram:ShipToTradeParty>');
  });
});

describe('code lists are open, their shape is not', () => {
  it('reads a CHF invoice and a 503 document type', () => {
    const base = sampleInvoice();
    const parsed = deserialize(serialize({ ...base, currency: 'CHF', typeCode: '503' }, 'EN 16931'));
    expect(parsed.currency).toBe('CHF');
    expect(parsed.typeCode).toBe('503');
  });

  it('refuses a currency that is not three upper-case letters, on read and on validation', () => {
    const base = sampleInvoice();
    const xml = serialize(base, 'EN 16931').replace('<ram:InvoiceCurrencyCode>EUR<', '<ram:InvoiceCurrencyCode>eur<');
    expect(() => deserialize(xml)).toThrow(FacturXDeserializeError);
    expect(validateEn16931({ ...base, currency: 'euro' }).errors.map((e) => e.code)).toContain('INVALID_CURRENCY_CODE');
  });

  it('applies G1.60 to 503, now that the model can carry it', () => {
    const base = sampleInvoice();
    const errors = validateEn16931({ ...base, businessProcess: 'S4', typeCode: '503' }, { validateFrenchRules: true }).errors;
    expect(errors.map((e) => e.code)).toContain('FORBIDDEN_TYPE_CODE_FOR_BUSINESS_PROCESS');
  });

  it('accepts the Canary Islands and Ceuta/Melilla categories', () => {
    const base = sampleInvoice();
    const invoice = {
      ...base,
      lines: [{ ...base.lines[0]!, vatCategory: 'L' as const, vatRate: 7 }],
      taxBreakdown: [{ type: 'VAT' as const, category: 'L' as const, rate: 7, basisAmount: 195, calculatedAmount: 13.65 }],
    };
    expect(deserialize(serialize(invoice, 'EN 16931')).lines[0]!.vatCategory).toBe('L');
  });
});

describe('BR-53 and BR-CO-16 with rounding', () => {
  it('requires BT-111 with BT-6, and BT-6 to differ from BT-5', () => {
    const base = sampleInvoice();
    const codes = (inv: Parameters<typeof validateEn16931>[0]) => validateEn16931(inv).errors.map((e) => `${e.field}:${e.code}`);

    expect(codes({ ...base, taxCurrency: 'USD' })).toContain('totals.taxTotalInTaxCurrency:MISSING_FIELD');
    expect(codes({ ...base, totals: { ...base.totals, taxTotalInTaxCurrency: 42 } })).toContain('taxCurrency:MISSING_FIELD');
    expect(codes({ ...base, taxCurrency: 'EUR', totals: { ...base.totals, taxTotalInTaxCurrency: 39 } })).toContain(
      'taxCurrency:INVALID_CURRENCY_CODE',
    );
    expect(codes({ ...base, taxCurrency: 'USD', totals: { ...base.totals, taxTotalInTaxCurrency: 42 } })).toEqual([]);
  });

  it('adds the rounding amount into the amount due', () => {
    const base = sampleInvoice();
    const ok = { ...base, totals: { ...base.totals, rounding: '-0.40', duePayable: '233.60' } };
    expect(validateEn16931(ok).errors).toEqual([]);
    const wrong = { ...base, totals: { ...base.totals, rounding: '-0.40' } };
    expect(validateEn16931(wrong).errors.map((e) => e.field)).toEqual(['totals.duePayable']);
  });

  it('computeTotals carries BT-114 and BT-111 through and nets the rounding into BT-115', () => {
    const base = sampleInvoice();
    const draft: DraftInvoice = {
      ...base,
      lines: base.lines.map(({ lineTotal: _lineTotal, ...line }) => line),
      taxBreakdown: base.taxBreakdown.map(({ basisAmount: _b, calculatedAmount: _c, ...tb }) => tb),
      taxCurrency: 'USD',
      totals: { rounding: '-0.40', taxTotalInTaxCurrency: '42.12' },
    };
    const result = computeTotals(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.totals).toMatchObject({ grandTotal: '234.00', rounding: '-0.40', duePayable: '233.60', taxTotalInTaxCurrency: '42.12' });
    expect(validateEn16931(result.invoice).errors).toEqual([]);
  });
});

const SAXON_URL = process.env['FACTURX_SAXON_URL'];

describe('the new fields against the official rule sets', () => {
  const TIMEOUT = 120_000;

  // Arithmetically consistent, unlike maximalInvoice, so every rule can pass.
  function consistentInvoiceWithNewFields(rounding: string | undefined) {
    const base = sampleInvoice();
    const result = computeTotals({
      ...base,
      lines: base.lines.map(({ lineTotal: _lineTotal, ...line }) => ({
        ...line,
        billingPeriod: { startDate: new Date(Date.UTC(2026, 6, 1)), endDate: new Date(Date.UTC(2026, 6, 31)) },
      })),
      taxBreakdown: base.taxBreakdown.map(({ basisAmount: _b, calculatedAmount: _c, ...tb }) => tb),
      taxCurrency: 'USD',
      shipTo: {
        name: 'Site client',
        globalId: '3012345000019',
        globalScheme: '0088',
        address: { lineOne: '1 rue du Site', postcode: '69001', city: 'Lyon', country: 'FR', countrySubdivision: 'Rhône' },
      },
      deliveryDate: new Date(Date.UTC(2026, 6, 15)),
      paymentMeans: [{ typeCode: '30', information: 'Virement', accountId: 'ACC-42' }],
      totals: { ...(rounding !== undefined ? { rounding } : {}), taxTotalInTaxCurrency: '42.12' },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.invoice;
  }

  it.each(['BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED'] as const)(
    'accepts a %s document carrying them',
    async (profile) => {
      if (SAXON_URL === undefined) return;
      // BT-114 exists from EN 16931 only; below it, generate refuses a
      // non-zero rounding (see the next test), so it is left out here.
      const invoice = consistentInvoiceWithNewFields(atLeast(profile, 'EN 16931') ? '-0.40' : undefined);
      const xml = serialize(invoice, profile);
      const result = await validateSchematron(xml, { endpoint: SAXON_URL, timeoutMs: TIMEOUT });
      expect(result.errors).toEqual([]);
    },
    TIMEOUT,
  );

  it('generate refuses a non-zero BT-114 below EN 16931, where it cannot be written', async () => {
    const invoice = consistentInvoiceWithNewFields('-0.40');
    for (const profile of ['BASIC WL', 'BASIC'] as const) {
      const error = await generate({ invoice, profile }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FacturXGenerateError);
      expect((error as FacturXGenerateError).validationErrors.map((e) => e.code)).toContain('UNEMITTABLE_ROUNDING_AMOUNT');
    }
    await expect(generate({ invoice, profile: 'EN 16931' })).resolves.toBeInstanceOf(Uint8Array);
    const zero = consistentInvoiceWithNewFields('0.00');
    await expect(generate({ invoice: zero, profile: 'BASIC' })).resolves.toBeInstanceOf(Uint8Array);
  });
});

// Found by /code-review: each of these is a valid document the deserializer
// refused, or read back into an invoice generate then refused.
describe('documents the schemas allow and the deserializer used to refuse', () => {
  it('reads a ship-to with no name, and writes it back without one', () => {
    const base = sampleInvoice();
    const xml = serialize({ ...base, shipTo: { address: { country: 'FR' } } }, 'EN 16931');
    expect(xml).toContain('<ram:ShipToTradeParty><ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID>');
    const parsed = deserialize(xml);
    expect(parsed.shipTo).toEqual({ address: { country: 'FR' } });
    expect(serialize(parsed, 'EN 16931')).toBe(xml);
  });

  it('reads a summation with no BT-110, and validates it as stating no VAT', () => {
    const base = sampleInvoice();
    const xml = serialize(base, 'MINIMUM').replace(/<ram:TaxTotalAmount[^>]*>[^<]*<\/ram:TaxTotalAmount>/, '');
    expect(xml).not.toContain('TaxTotalAmount');
    expect(deserialize(xml).totals.taxTotal).toBeUndefined();

    const { taxTotal: _t, ...noVatTotal } = base.totals;
    const errors = validateEn16931({ ...base, totals: noVatTotal }).errors.map((e) => e.field);
    // The breakdown still carries VAT, so BR-CO-14 and BR-CO-15 disagree.
    expect(errors).toEqual(['totals.taxTotal', 'totals.grandTotal']);
  });

  it('drops a tax currency equal to the invoice currency, so the invoice regenerates', async () => {
    const base = sampleInvoice();
    const xml = serialize(base, 'EN 16931').replace(
      '<ram:InvoiceCurrencyCode>',
      '<ram:TaxCurrencyCode>EUR</ram:TaxCurrencyCode><ram:InvoiceCurrencyCode>',
    );
    const parsed = deserialize(xml);
    expect(parsed.taxCurrency).toBeUndefined();
    expect(parsed.totals.taxTotal).toBe('39.00');
    await expect(generate({ invoice: parsed, profile: 'EN 16931' })).resolves.toBeInstanceOf(Uint8Array);
  });
});
