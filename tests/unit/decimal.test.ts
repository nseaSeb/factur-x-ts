import { describe, expect, it } from 'vitest';
import { add, cmp, dec, eq, mul, parseDecimal, percentOf, round, sub, toFixed, toKey, toText } from '../../src/decimal.js';
import { normalizeInvoice } from '../../src/normalize.js';
import { serialize, FacturXSerializeError } from '../../src/xml/serializer.js';
import { generate, FacturXGenerateError } from '../../src/pdf/generator.js';
import { sampleInvoice } from '../fixtures/invoice.js';

describe('parseDecimal', () => {
  it.each([
    [0.1 + 0.2, 'FLOAT_DRIFT'],
    [1.1 * 3, 'FLOAT_DRIFT'],
    [4.35 * 100, 'FLOAT_DRIFT'],
    [1 / 3, 'FLOAT_DRIFT'],
    [Number.NaN, 'NOT_FINITE'],
    [Number.POSITIVE_INFINITY, 'NOT_FINITE'],
    [1e21, 'NOT_A_DECIMAL'],
    [1e-7, 'NOT_A_DECIMAL'],
    ['1e2', 'NOT_A_DECIMAL'],
    ['0x10', 'NOT_A_DECIMAL'],
    ['1,5', 'NOT_A_DECIMAL'],
    ['', 'NOT_A_DECIMAL'],
    ['.', 'NOT_A_DECIMAL'],
    ['-', 'NOT_A_DECIMAL'],
    ['9'.repeat(33), 'TOO_LONG'],
  ])('refuses %s as %s', (input, reason) => {
    expect(parseDecimal(input)).toEqual({ ok: false, reason });
  });

  it.each([
    [19.99, '19.99'],
    [19.99 * 3, '59.97'],
    [0.000001, '0.000001'],
    [-0, '0'],
    ['100.00', '100.00'],
    ['+.5', '0.5'],
    ['-007.10', '-7.10'],
    ['10.', '10'],
  ])('accepts %s as "%s"', (input, text) => {
    const parsed = parseDecimal(input);
    expect(parsed.ok && toText(parsed.value)).toBe(text);
  });

  it('accepts any number of decimals in a string, which was written, not computed', () => {
    expect(parseDecimal('0.30000000000000004').ok).toBe(true);
  });
});

describe('arithmetic', () => {
  it('is exact where floats are not', () => {
    expect(toText(add(dec('0.1'), dec('0.2')))).toBe('0.3');
    expect(toText(sub(add(dec('0.02'), dec('0.03')), dec('0.05')))).toBe('0.00');
    expect(toText(mul(dec('19.99'), dec(3)))).toBe('59.97');
  });

  it('rounds half away from zero, where a float rounds by its representation', () => {
    expect((1.005).toFixed(2)).toBe('1.00');
    expect(toFixed(dec('1.005'), 2)).toBe('1.01');
    expect(toFixed(dec('-1.005'), 2)).toBe('-1.01');
    expect(toFixed(dec('2.675'), 2)).toBe('2.68');
    expect(toFixed(dec('1.0049'), 2)).toBe('1.00');
    expect(toText(round(dec('12'), 2))).toBe('12.00');
  });

  it('never writes a negative zero', () => {
    expect(toFixed(dec('-0.001'), 2)).toBe('0.00');
    expect(toFixed(sub(dec('0.02'), dec('0.02')), 2)).toBe('0.00');
  });

  it('takes a percentage exactly', () => {
    expect(toText(percentOf(dec('99.99'), dec('5.5')))).toBe('5.49945');
    expect(toFixed(percentOf(dec('99.99'), dec('5.5')), 2)).toBe('5.50');
  });

  it('compares by value, not by spelling', () => {
    expect(eq(dec('20'), dec('20.00'))).toBe(true);
    expect(toKey(dec('20.00'))).toBe(toKey(dec(20)));
    expect(toKey(dec('0.50'))).toBe('0.5');
    expect(cmp(dec('-1'), dec('0.5'))).toBe(-1);
  });
});

describe('normalizeInvoice', () => {
  it('returns every refused field with its path, not the first', () => {
    const base = sampleInvoice();
    const result = normalizeInvoice({
      ...base,
      lines: [{ ...base.lines[0]!, netPrice: 0.1 + 0.2, quantity: Number.NaN }],
      totals: { ...base.totals, grandTotal: '1,5' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => [e.field, e.reason])).toEqual([
      ['lines[0].quantity', 'NOT_FINITE'],
      ['lines[0].netPrice', 'FLOAT_DRIFT'],
      ['totals.grandTotal', 'NOT_A_DECIMAL'],
    ]);
    expect(result.errors[1]!.message).toContain('pass the amount as a string');
  });

  it('accepts numbers and strings alike, and hands back canonical strings', () => {
    const base = sampleInvoice();
    const result = normalizeInvoice({ ...base, totals: { ...base.totals, grandTotal: '234.00', duePayable: 234 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.totals.grandTotal).toBe('234.00');
    expect(result.invoice.totals.duePayable).toBe('234');
  });

  it('does not add keys the source did not have', () => {
    const result = normalizeInvoice(sampleInvoice());
    expect(result.ok && 'prepaid' in result.invoice.totals).toBe(false);
  });
});

describe('the entry points refuse drift the same way', () => {
  const drifted = () => {
    const base = sampleInvoice();
    return { ...base, lines: [{ ...base.lines[0]!, netPrice: 0.1 + 0.2 }] };
  };

  it('serialize throws rather than write it', () => {
    expect(() => serialize(drifted(), 'EN 16931')).toThrow(FacturXSerializeError);
  });

  it('generate reports it as an invalid invoice, at every profile', async () => {
    for (const profile of ['EN 16931', 'BASIC', 'EXTENDED'] as const) {
      const error = await generate({ invoice: drifted(), profile }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FacturXGenerateError);
      expect((error as FacturXGenerateError).validationErrors.map((e) => e.code)).toContain('INVALID_DECIMAL');
    }
  });

  it('writes a string amount with more decimals than the wire, rounded half away from zero', () => {
    const base = sampleInvoice();
    const xml = serialize({ ...base, totals: { ...base.totals, taxTotal: '39.005' } }, 'EN 16931');
    expect(xml).toContain('>39.01</ram:TaxTotalAmount>');
  });
});
