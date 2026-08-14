import { describe, expect, it } from 'vitest';
import { hasDoctype, resolveProfile, FacturXProfileNotDetectedError } from '../../src/validate/shared.js';
import { serialize } from '../../src/xml/serializer.js';
import { sampleInvoice } from '../fixtures/invoice.js';

describe('hasDoctype', () => {
  it('detects a real DOCTYPE in the prolog', () => {
    expect(hasDoctype('<!DOCTYPE foo><rsm:CrossIndustryInvoice/>')).toBe(true);
    expect(hasDoctype('  \n <!DOCTYPE foo><rsm:CrossIndustryInvoice/>')).toBe(true);
  });

  it('sees past a leading XML declaration and comments to find a DOCTYPE', () => {
    const xml = `<?xml version="1.0"?><!-- note --><!DOCTYPE foo><rsm:CrossIndustryInvoice/>`;
    expect(hasDoctype(xml)).toBe(true);
  });

  it('does not flag the literal substring "<!DOCTYPE" inside element content', () => {
    const xml =
      `<?xml version="1.0"?><rsm:CrossIndustryInvoice>` +
      `<ram:IncludedNote>Example: write &lt;!DOCTYPE foo&gt; at the top.</ram:IncludedNote>` +
      `</rsm:CrossIndustryInvoice>`;
    expect(hasDoctype(xml)).toBe(false);
  });

  it('returns false for a document with no DOCTYPE at all', () => {
    expect(hasDoctype('<rsm:CrossIndustryInvoice></rsm:CrossIndustryInvoice>')).toBe(false);
  });
});

describe('resolveProfile', () => {
  it('uses the explicit profile when given, without inspecting the XML', () => {
    expect(resolveProfile('not even xml', 'EXTENDED')).toBe('EXTENDED');
  });

  it('detects the profile from well-formed XML when none is given explicitly', () => {
    const xml = serialize(sampleInvoice(), 'BASIC WL');
    expect(resolveProfile(xml, undefined)).toBe('BASIC WL');
  });

  it('throws when detection fails and no fallback is given (validateSchematron: a wrong guess misleads business-rule results)', () => {
    expect(() => resolveProfile('not xml at all', undefined)).toThrow(FacturXProfileNotDetectedError);
    expect(() => resolveProfile('<rsm:CrossIndustryInvoice/>', undefined)).toThrow(
      FacturXProfileNotDetectedError,
    );
  });

  it('uses the fallback when detection fails and one is given (validateXsd: EN 16931 is a structural superset)', () => {
    expect(resolveProfile('not xml at all', undefined, 'EN 16931')).toBe('EN 16931');
    expect(resolveProfile('<rsm:CrossIndustryInvoice/>', undefined, 'EN 16931')).toBe('EN 16931');
  });

  it('prefers a successfully detected profile over the fallback', () => {
    const xml = serialize(sampleInvoice(), 'MINIMUM');
    expect(resolveProfile(xml, undefined, 'EN 16931')).toBe('MINIMUM');
  });
});
