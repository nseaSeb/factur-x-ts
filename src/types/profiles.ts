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

export interface FacturXMetadata {
  readonly documentType: 'INVOICE';
  readonly documentFileName: 'factur-x.xml';
  readonly version: '1.07';
  readonly conformanceLevel: Profile;
}
