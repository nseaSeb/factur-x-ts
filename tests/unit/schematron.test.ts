import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import {
  parseSvrl,
  validateSchematron,
  FacturXSchematronNotBundledError,
} from '../../src/validate/schematron.js';
import { sampleInvoice } from '../fixtures/invoice.js';

function svrl(findings: string): string {
  return (
    `<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">` +
    findings +
    `</svrl:schematron-output>`
  );
}

describe('parseSvrl', () => {
  it('returns no violations for an empty report', () => {
    expect(parseSvrl(svrl(''))).toEqual([]);
  });

  it('extracts a failed-assert with its message, location and test', () => {
    const violations = parseSvrl(
      svrl(
        `<svrl:failed-assert test="BR-01" location="/x/y" flag="error">` +
          `<svrl:text>An invoice shall have an invoice number.</svrl:text>` +
          `</svrl:failed-assert>`,
      ),
    );
    expect(violations).toEqual([
      {
        message: 'An invoice shall have an invoice number.',
        location: '/x/y',
        test: 'BR-01',
        flag: 'error',
      },
    ]);
  });

  it('extracts a successful-report alongside a failed-assert', () => {
    const violations = parseSvrl(
      svrl(
        `<svrl:successful-report test="BR-CO-99" location="/a"><svrl:text>note</svrl:text></svrl:successful-report>` +
          `<svrl:failed-assert test="BR-02" location="/b"><svrl:text>bad</svrl:text></svrl:failed-assert>`,
      ),
    );
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.test)).toEqual(['BR-02', 'BR-CO-99']);
  });

  it('omits a flag attribute that is absent, rather than setting it to undefined', () => {
    const violations = parseSvrl(
      svrl(`<svrl:failed-assert test="BR-03" location="/c"><svrl:text>x</svrl:text></svrl:failed-assert>`),
    );
    expect(violations[0]).not.toHaveProperty('flag');
  });
});

describe('validateSchematron', () => {
  it('throws for a profile whose Schematron is not bundled', async () => {
    const xml = serialize(sampleInvoice(), 'BASIC');
    await expect(validateSchematron(xml)).rejects.toBeInstanceOf(FacturXSchematronNotBundledError);
  });

  it('rejects XML carrying a DOCTYPE without contacting a Saxon server', async () => {
    const xml = '<!DOCTYPE foo><rsm:CrossIndustryInvoice></rsm:CrossIndustryInvoice>';
    const result = await validateSchematron(xml, { endpoint: 'http://192.0.2.1/unreachable' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/DOCTYPE/);
  });
});
