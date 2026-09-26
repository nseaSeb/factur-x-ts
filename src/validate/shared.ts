// src/validate/shared.ts
// Helpers shared between validateXsd and validateSchematron: both work over
// raw, untrusted CII XML and need the same input hygiene and profile
// resolution safety net.

import type { Profile } from '../types/profiles.js';
import { detectProfile } from '../xml/guideline.js';

// Moved to src/xml/hygiene.ts so the XML readers (deserializer, guideline,
// XMP) can apply the same policy without importing the validators.
export { stripBom, hasDoctype } from '../xml/hygiene.js';

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
