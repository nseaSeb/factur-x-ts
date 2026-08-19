import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import { deserialize, FacturXDeserializeError } from '../../src/xml/deserializer.js';
import { sampleInvoice } from '../fixtures/invoice.js';

describe('deserialize — NaN guard on numeric fields', () => {
  // Number() silently returns NaN for a continental "1,5" or any other
  // non-numeric text; requireNumber() must throw instead of letting it
  // through into the model, unlike parseOptionalAmount()'s undefined-on-NaN
  // handling for genuinely optional amounts.

  it('throws on an invalid ram:BilledQuantity', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931').replace(
      '<ram:BilledQuantity unitCode="C62">2.0000</ram:BilledQuantity>',
      '<ram:BilledQuantity unitCode="C62">1,5</ram:BilledQuantity>',
    );
    expect(() => deserialize(xml)).toThrow(FacturXDeserializeError);
  });

  it('throws on an invalid line ram:RateApplicablePercent', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931').replace(
      '<ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20.00</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation>',
      '<ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>vingt</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation>',
    );
    expect(() => deserialize(xml)).toThrow(FacturXDeserializeError);
  });

  it('throws on an invalid header ram:RateApplicablePercent (tax breakdown)', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931').replace(
      '<ram:DueDateTypeCode>5</ram:DueDateTypeCode><ram:RateApplicablePercent>20.00</ram:RateApplicablePercent>',
      '<ram:DueDateTypeCode>5</ram:DueDateTypeCode><ram:RateApplicablePercent>vingt</ram:RateApplicablePercent>',
    );
    expect(() => deserialize(xml)).toThrow(FacturXDeserializeError);
  });

  it('throws on an invalid ram:CalculationPercent in an allowance/charge', () => {
    const base = sampleInvoice();
    const invoice = {
      ...base,
      allowances: [{ amount: 5, percent: 2.5, vatCategory: 'S' as const, vatRate: 20 }],
    };
    const xml = serialize(invoice, 'EN 16931').replace(
      '<ram:CalculationPercent>2.50</ram:CalculationPercent>',
      '<ram:CalculationPercent>deux virgule cinq</ram:CalculationPercent>',
    );
    expect(() => deserialize(xml)).toThrow(FacturXDeserializeError);
  });
});

describe('deserialize — ram:SpecifiedTradePaymentTerms', () => {
  it('parses BT-20 (Description) and BT-9 (DueDateDateTime) together', () => {
    const invoice = {
      ...sampleInvoice(),
      paymentTerms: '30 jours net',
      paymentDueDate: new Date(Date.UTC(2026, 8, 8)),
    };
    const result = deserialize(serialize(invoice, 'EN 16931'));

    expect(result.paymentTerms).toBe('30 jours net');
    expect(result.paymentDueDate).toEqual(new Date(Date.UTC(2026, 8, 8)));
  });

  it('omits both fields when the invoice carries neither', () => {
    const invoice = { ...sampleInvoice(), paymentTerms: undefined };
    const result = deserialize(serialize(invoice, 'EN 16931'));

    expect(result).not.toHaveProperty('paymentTerms');
    expect(result).not.toHaveProperty('paymentDueDate');
  });

  it('reads the first entry, not undefined, when a third-party EXTENDED document repeats the group', () => {
    // EXTENDED's XSD declares maxOccurs="unbounded" here (repeated installment
    // terms), which fast-xml-parser only returns as an array when told to —
    // this library's own serializer never emits more than one, so this can
    // only be exercised with hand-crafted XML standing in for a third party.
    const base = serialize(sampleInvoice(), 'EN 16931');
    const xml = base.replace(
      '<ram:SpecifiedTradePaymentTerms><ram:Description>30 jours net</ram:Description></ram:SpecifiedTradePaymentTerms>',
      '<ram:SpecifiedTradePaymentTerms><ram:Description>First</ram:Description></ram:SpecifiedTradePaymentTerms>' +
        '<ram:SpecifiedTradePaymentTerms><ram:Description>Second</ram:Description></ram:SpecifiedTradePaymentTerms>',
    );
    expect(xml).not.toBe(base); // guards against the replace silently no-op'ing

    expect(deserialize(xml).paymentTerms).toBe('First');
  });
});

describe('deserialize — ram:PostalTradeAddress', () => {
  it('accepts a party address carrying only ram:CountryID', () => {
    // Only CountryID is mandatory per the CII schema and EN 16931's own
    // Schematron — Postcode/LineOne/City are all minOccurs="0".
    const xml = serialize(sampleInvoice(), 'EN 16931').replace(
      '<ram:PostcodeCode>69000</ram:PostcodeCode><ram:LineOne>2 avenue des Champs</ram:LineOne><ram:CityName>Lyon</ram:CityName><ram:CountryID>FR</ram:CountryID>',
      '<ram:CountryID>FR</ram:CountryID>',
    );
    const result = deserialize(xml);
    expect(result.buyer.address).toEqual({ country: 'FR' });
  });

  it('still throws when ram:CountryID itself is missing', () => {
    const xml = serialize(sampleInvoice(), 'EN 16931').replace(
      '<ram:PostcodeCode>69000</ram:PostcodeCode><ram:LineOne>2 avenue des Champs</ram:LineOne><ram:CityName>Lyon</ram:CityName><ram:CountryID>FR</ram:CountryID>',
      '<ram:PostcodeCode>69000</ram:PostcodeCode><ram:LineOne>2 avenue des Champs</ram:LineOne><ram:CityName>Lyon</ram:CityName>',
    );
    expect(() => deserialize(xml)).toThrow(FacturXDeserializeError);
  });
});
