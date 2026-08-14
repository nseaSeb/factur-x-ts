// src/types/schematron.ts
// Result shapes for Schematron validation.

import type { Profile } from './profiles.js';

export interface SchematronViolation {
  readonly message?: string;
  readonly location?: string;
  readonly test?: string;
  // The SVRL severity ("warning" / "info" are non-blocking); absent for a
  // plain error.
  readonly flag?: string;
}

export interface SchematronValidationResult {
  readonly valid: boolean;
  readonly errors: readonly SchematronViolation[];
  readonly warnings: readonly SchematronViolation[];
}

export interface SchematronValidationOptions {
  /** Schematron rule set to run. Defaults to the profile declared in the XML. */
  readonly profile?: Profile;
  /** Saxon `/transform` endpoint. Defaults to `http://localhost:5000/transform`. */
  readonly endpoint?: string;
  /** Override the code-list DB URL the XSLT resolves via `document(...)`. */
  readonly codedbUrl?: string;
  /** Supply a compiled Schematron XSLT directly instead of a bundled one. */
  readonly xsl?: string;
  /** HTTP timeout, in milliseconds. Defaults to 20000. */
  readonly timeoutMs?: number;
}
