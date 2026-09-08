// src/xml/guideline.ts
// Read the two header facts a raw CII document declares about itself — the
// profile, from ram:GuidelineSpecifiedDocumentContextParameter/ram:ID, and the
// invoice number, from rsm:ExchangedDocument/ram:ID — without deserializing
// it. Used wherever the XML comes without PDF/A-3 metadata, or is a
// third-party document the full deserializer may not model.

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
    readonly ExchangedDocument?: {
      readonly ID?: string;
    };
  };
}

// fast-xml-parser instances are stateless once configured — one shared
// instance avoids rebuilding the parser on every detectProfile call.
const guidelineParser = new XMLParser({
  ignoreAttributes: true,
  textNodeName: '#text',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  ignoreDeclaration: true,
});

function parseHeader(xml: string): ParsedGuideline | undefined {
  try {
    return guidelineParser.parse(xml) as ParsedGuideline;
  } catch {
    return undefined;
  }
}

export function detectProfile(xml: string): Profile | undefined {
  const urn =
    parseHeader(xml)?.CrossIndustryInvoice?.ExchangedDocumentContext
      ?.GuidelineSpecifiedDocumentContextParameter?.ID;
  return urn === undefined ? undefined : profileForGuidelineUrn(urn);
}

/** BT-1, the invoice number — or undefined when the document does not carry one where CII puts it. */
export function detectInvoiceNumber(xml: string): string | undefined {
  const id = parseHeader(xml)?.CrossIndustryInvoice?.ExchangedDocument?.ID;
  return id === undefined || id === '' ? undefined : id;
}
