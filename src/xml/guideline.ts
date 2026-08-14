// src/xml/guideline.ts
// Detect the Factur-X profile from raw CII XML, by reading
// ram:GuidelineSpecifiedDocumentContextParameter/ram:ID. Used when a caller
// has XML with no accompanying PDF/A-3 metadata to read the profile from.

import { XMLParser } from 'fast-xml-parser';
import type { Profile } from '../types/profiles.js';
import { profileForGuidelineUrn } from '../types/profiles.js';

interface ParsedGuideline {
  readonly CrossIndustryInvoice?: {
    readonly ExchangedDocumentContext?: {
      readonly GuidelineSpecifiedDocumentContextParameter?: {
        readonly ID?: string;
      };
    };
  };
}

export function detectProfile(xml: string): Profile | undefined {
  const parser = new XMLParser({
    ignoreAttributes: true,
    textNodeName: '#text',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    ignoreDeclaration: true,
  });

  let parsed: ParsedGuideline;
  try {
    parsed = parser.parse(xml) as ParsedGuideline;
  } catch {
    return undefined;
  }

  const urn =
    parsed.CrossIndustryInvoice?.ExchangedDocumentContext
      ?.GuidelineSpecifiedDocumentContextParameter?.ID;
  return urn === undefined ? undefined : profileForGuidelineUrn(urn);
}
