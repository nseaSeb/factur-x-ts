// src/types/validation.ts
// Validation result shapes. Kept in `types` rather than in the profile module so
// that both en16931.ts and the national rule modules can use them without a
// circular import.

export type ValidationErrorCode =
  | 'MISSING_FIELD'
  | 'EMPTY_VALUE'
  | 'NO_LINES'
  | 'NO_TAX_BREAKDOWN'
  | 'INVALID_VAT_RATE'
  | 'MISSING_EXEMPTION_REASON'
  | 'MISSING_BUYER_VAT_ID'
  | 'MISSING_TAX_BREAKDOWN_GROUP'
  | 'AMOUNT_MISMATCH'
  // BR-CL-06: BT-8 restricted by EN 16931 to a subset of UNTDID 2475.
  | 'INVALID_VAT_POINT_DATE'
  | 'UNEMITTABLE_VAT_POINT_DATE'
  // French reform (opt-in): G1.02, G1.60, S1.13, BT-30 / BT-47.
  | 'MISSING_BUSINESS_PROCESS'
  | 'INVALID_BUSINESS_PROCESS'
  | 'FORBIDDEN_TYPE_CODE_FOR_BUSINESS_PROCESS'
  | 'INCONSISTENT_VAT_POINT_DATE'
  | 'MISSING_LEGAL_ID'
  | 'INVALID_LEGAL_ID'
  // BR-CO-25: BT-9 or BT-20 required whenever duePayable is positive.
  | 'MISSING_PAYMENT_TERMS';

export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly field: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

export interface ValidationOptions {
  /**
   * BR-CL-06 — restrict BT-8 to the CII codes 5 / 29 / 72.
   *
   * Restricted by EN 16931 itself, so this is universally correct and **on by
   * default**. Still switchable: "invalid" does not mean "must never be
   * serializable" — the extract → parse → correct → generate pipeline over a
   * received invoice is a central use case, and blocking it without recourse
   * would be a dead end.
   */
  readonly validateVatPointDate?: boolean;

  /**
   * The French reform rule set: the G1.02 closed list for BT-23 and its
   * cross-rules G1.60 / S1.13, plus the mandatory SIREN identifiers
   * BT-30 / BT-47.
   *
   * **Off by default**: none of these are EN 16931 restrictions. BT-23 values
   * are unrestricted by the standard (Peppol and Chorus Pro use their own), and
   * SIREN is meaningless outside France — applying either universally would
   * lock out non-French callers and break round-tripping of third-party
   * documents.
   */
  readonly validateFrenchRules?: boolean;
}
