import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import { detectProfile } from '../../src/xml/guideline.js';
import { validateXsd } from '../../src/validate/xsd.js';
import { Profile } from '../../src/types/profiles.js';
import { sampleInvoice } from '../fixtures/invoice.js';

// Swap two sibling top-level elements to produce XSD-invalid (wrong sequence
// order) XML that no business-rule validator would catch — proving the XSD
// wiring itself, not just well-formedness.
function swapSiblings(xml: string, tagA: string, tagB: string): string {
  const blockRe = (tag: string) => new RegExp(`<rsm:${tag}>[\\s\\S]*?</rsm:${tag}>`);
  const matchA = xml.match(blockRe(tagA));
  const matchB = xml.match(blockRe(tagB));
  if (matchA?.index === undefined || matchB?.index === undefined) {
    throw new Error(`fixture error: <rsm:${tagA}> or <rsm:${tagB}> not found`);
  }

  // Plain index slicing rather than String.replace: the blocks being swapped
  // are raw XML, and using one as the *replacement* argument to .replace()
  // would let $&, $`, $', $$, $1... be interpreted as live substitution
  // patterns instead of literal text.
  const [start1, end1, start2, end2] =
    matchA.index < matchB.index
      ? [matchA.index, matchA.index + matchA[0].length, matchB.index, matchB.index + matchB[0].length]
      : [matchB.index, matchB.index + matchB[0].length, matchA.index, matchA.index + matchA[0].length];
  const firstBlock = xml.slice(start1, end1);
  const secondBlock = xml.slice(start2, end2);

  return xml.slice(0, start1) + secondBlock + xml.slice(end1, start2) + firstBlock + xml.slice(end2);
}

describe('validateXsd', () => {
  it('accepts a well-formed EN 16931 invoice', async () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    const result = await validateXsd(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects XML with sibling elements out of sequence', async () => {
    const xml = serialize(sampleInvoice(), 'EN 16931');
    const scrambled = swapSiblings(xml, 'ExchangedDocumentContext', 'ExchangedDocument');
    const result = await validateXsd(scrambled);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects XML carrying a DOCTYPE without invoking the validator', async () => {
    const xml = '<!DOCTYPE foo><rsm:CrossIndustryInvoice></rsm:CrossIndustryInvoice>';
    const result = await validateXsd(xml);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/DOCTYPE/);
  });

  // All five profiles ship a schema, so there is no longer a profile that
  // reaches FacturXXsdNotBundledError — the error stays for a bundle removed
  // later, and the reachable claim worth testing is the opposite one.
  it.each(Object.values(Profile))('validates a %s document against its own bundled schema', async (profile) => {
    const xml = serialize(sampleInvoice(), profile);
    expect(detectProfile(xml)).toBe(profile);
    const result = await validateXsd(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('validates EXTENDED-profile XML against the EXTENDED schema, detected from the XML', async () => {
    const xml = serialize(sampleInvoice(), 'EXTENDED');
    // Prove detection actually picked EXTENDED, not silently falling back to
    // EN 16931 — which would also report valid: true here and hide a broken
    // EXTENDED schema bundle.
    expect(detectProfile(xml)).toBe('EXTENDED');
    const result = await validateXsd(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects EXTENDED-profile XML with sibling elements out of sequence', async () => {
    const xml = serialize(sampleInvoice(), 'EXTENDED');
    const scrambled = swapSiblings(xml, 'ExchangedDocumentContext', 'ExchangedDocument');
    const result = await validateXsd(scrambled, { profile: 'EXTENDED' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
