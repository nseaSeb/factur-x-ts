// src/types/xsd.ts
// Result shapes for XSD validation.

import type { Profile } from './profiles.js';

export interface XsdValidationError {
  readonly message: string;
}

export interface XsdValidationResult {
  readonly valid: boolean;
  readonly errors: readonly XsdValidationError[];
}

export interface XsdValidationOptions {
  /** Schema to validate against. Defaults to the profile declared in the XML. */
  readonly profile?: Profile;
}
