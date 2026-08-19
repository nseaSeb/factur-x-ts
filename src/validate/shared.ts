// src/validate/shared.ts
// Helpers shared between validateXsd and validateSchematron: both work over
// raw, untrusted CII XML and need the same input hygiene and profile
// resolution safety net.

import type { Profile } from '../types/profiles.js';
import { detectProfile } from '../xml/guideline.js';

export function stripBom(xml: string): string {
  return xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
}

// A real XML DOCTYPE can only appear in the prolog, before the root element,
// preceded only by whitespace, the XML declaration, comments or processing
// instructions. Scanning only that prefix — rather than testing "<!DOCTYPE"
// against the whole document — avoids flagging a legitimate document whose
// text content happens to contain that literal substring (e.g. a free-text
// note field used as an XML-authoring example).
export function hasDoctype(xml: string): boolean {
  let i = 0;
  const len = xml.length;
  for (;;) {
    while (i < len && /\s/.test(xml.charAt(i))) i++;
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i);
      if (end === -1) return false;
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i);
      if (end === -1) return false;
      i = end + 3;
      continue;
    }
    // Case-insensitive: strict XML requires the uppercase keyword, but this
    // is a defense-in-depth XXE pre-filter meant to reject anything a
    // downstream processor might still treat as a doctype declaration in
    // lenient/recovery mode — matching only the strict-case form would let a
    // miscased "<!doctype" straight through to that processor. Safe to do
    // here: this position is only ever reached by whitespace, an XML
    // declaration, comments or processing instructions (per the loop above),
    // never document body text, so there is no free-text false-positive risk
    // the way a whole-document substring search would have.
    return /^<!doctype/i.test(xml.slice(i, i + 9));
  }
}

export class FacturXProfileNotDetectedError extends Error {
  constructor() {
    super(
      'Could not detect the Factur-X profile from the XML (no recognizable ' +
        'ram:GuidelineSpecifiedDocumentContextParameter/ram:ID). Pass options.profile explicitly.',
    );
    this.name = 'FacturXProfileNotDetectedError';
  }
}

// Resolves which profile to validate against: an explicit option always
// wins, and a detected profile is used as-is (including one with no bundled
// schema/rule set, which the caller reports via its own *NotBundledError).
//
// When neither resolves, callers decide what "undetectable" means for them:
// - Omit `fallback` (validateSchematron) to throw. Business rules genuinely
//   differ per profile, so guessing produces a misleading pass/fail against
//   the wrong rule set — worse than an error.
// - Pass `fallback` (validateXsd uses 'EN 16931') to default to it instead.
//   EN 16931's XSD is a structural superset, so validating an
//   unrecognized-profile document against it is still a meaningful
//   structural check — exactly the extract → parse → correct → generate flow
//   over a third-party document this library is meant to support.
export function resolveProfile(xml: string, explicit: Profile | undefined, fallback?: Profile): Profile {
  if (explicit !== undefined) {
    return explicit;
  }
  const detected = detectProfile(xml);
  if (detected !== undefined) {
    return detected;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new FacturXProfileNotDetectedError();
}
