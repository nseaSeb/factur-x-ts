// src/types/xsd.ts
// Result shapes for XSD validation.

import type { Profile } from './profiles.js';

export interface XsdValidationError {
  readonly message: string;
  /** The message exactly as xmllint printed it, including file name and line number. Absent for factur-x-ts's own synthetic errors (e.g. the DOCTYPE rejection), which never reach xmllint. */
  readonly rawMessage?: string;
  /** Position of the error, when xmllint-wasm could parse one out of the raw message. */
  readonly location?: {
    readonly fileName: string;
    readonly lineNumber: number;
  };
}

export interface XsdValidationResult {
  readonly valid: boolean;
  readonly errors: readonly XsdValidationError[];
}

export interface XsdValidationOptions {
  /** Schema to validate against. Defaults to the profile declared in the XML. */
  readonly profile?: Profile;
}
