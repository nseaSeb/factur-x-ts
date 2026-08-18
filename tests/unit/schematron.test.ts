import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import {
  parseSvrl,
  validateSchematron,
  FacturXSchematronNotBundledError,
  FacturXSaxonError,
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

  it('flattens svrl:text to a string even when it contains child markup', () => {
    // fast-xml-parser returns an object, not a string, for an element with
    // child elements — reachable via a caller-supplied options.xsl (e.g. a
    // national rule set) that emphasizes part of its message text. Order
    // isn't preserved (fast-xml-parser groups mixed content by tag name),
    // but every fragment of text must survive as a string, not "[object
    // Object]".
    const violations = parseSvrl(
      svrl(
        `<svrl:failed-assert test="BR-04" location="/d">` +
          `<svrl:text>Missing <b>mandatory</b> field</svrl:text>` +
          `</svrl:failed-assert>`,
      ),
    );
    expect(typeof violations[0]?.message).toBe('string');
    expect(violations[0]?.message).toContain('mandatory');
    expect(violations[0]?.message).toContain('Missing');
    expect(violations[0]?.message).toContain('field');
  });

  it('throws rather than silently returning no violations for a non-SVRL body', () => {
    // A misconfigured endpoint, a Saxon fault page, or a plain-text error
    // response would otherwise parse to "no failed-assert / successful-report
    // found" and be read as a clean valid: true.
    expect(() => parseSvrl('<html><body>502 Bad Gateway</body></html>')).toThrow(FacturXSaxonError);
    expect(() => parseSvrl('')).toThrow(FacturXSaxonError);
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

  it('throws FacturXSaxonError, not a plain Error, when the server is unreachable', async () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    await expect(
      validateSchematron(xml, { endpoint: 'http://127.0.0.1:1/transform', timeoutMs: 2000 }),
    ).rejects.toBeInstanceOf(FacturXSaxonError);
  });
});
