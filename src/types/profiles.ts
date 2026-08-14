// src/types/profiles.ts
// Factur-X / ZUGFeRD profiles.
// EN 16931 for the moment

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
  readonly documentFileName: 'factur-x.xml';
  readonly version: '1.07';
  readonly conformanceLevel: Profile;
}
