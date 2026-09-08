// src/types/profiles.ts
// Factur-X / ZUGFeRD profiles.

import type { FacturXAttachmentName } from '../pdf/filespec.js';

export const Profile = {
  EN_16931: 'EN 16931',
  EXTENDED: 'EXTENDED',
  BASIC: 'BASIC',
  BASIC_WL: 'BASIC WL',
  MINIMUM: 'MINIMUM',
} as const;

export type Profile = (typeof Profile)[keyof typeof Profile];

// The guideline URN each profile serializes into
// ram:GuidelineSpecifiedDocumentContextParameter/ram:ID.
export const GUIDELINE_URN: Record<Profile, string> = {
  MINIMUM: 'urn:factur-x.eu:1p0:minimum',
  'BASIC WL': 'urn:factur-x.eu:1p0:basicwl',
  BASIC: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
  'EN 16931': 'urn:cen.eu:en16931:2017',
  EXTENDED: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
};

// The five profiles are strictly nested: every element name the MINIMUM schema
// declares is in BASIC WL, and so on up to EXTENDED. That is what lets a single
// ordering decide what the serializer may emit, instead of one predicate per
// profile per element.
//
// Nesting holds for element *names*, not for where they may appear: BASIC WL
// allows ram:ApplicableTradeTax at header level only, BASIC also at line level.
// So the floor belongs on the emitter, never on the element.
const PROFILE_RANK: Record<Profile, number> = {
  MINIMUM: 0,
  'BASIC WL': 1,
  BASIC: 2,
  'EN 16931': 3,
  EXTENDED: 4,
};

/** Whether `profile` is `floor` or richer. */
export function atLeast(profile: Profile, floor: Profile): boolean {
  return PROFILE_RANK[profile] >= PROFILE_RANK[floor];
}

const PROFILE_BY_GUIDELINE_URN: ReadonlyMap<string, Profile> = new Map(
  Object.entries(GUIDELINE_URN).map(([profile, urn]) => [urn, profile as Profile]),
);

// Reverse lookup used when a profile isn't known ahead of time (e.g. validating
// raw CII XML received from a third party).
export function profileForGuidelineUrn(urn: string): Profile | undefined {
  return PROFILE_BY_GUIDELINE_URN.get(urn);
}

export interface FacturXMetadata {
  readonly documentType: 'INVOICE';
  // Whichever accepted name the PDF actually carries — factur-x.xml or
  // zugferd-invoice.xml, both legal per FACTURX_ATTACHMENT_NAMES. Read back
  // verbatim, not normalized: normalizing this would misreport what the
  // producer actually wrote.
  readonly documentFileName: FacturXAttachmentName;
  readonly version: '1.07';
  readonly conformanceLevel: Profile;
}
