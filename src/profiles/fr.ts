// src/profiles/fr.ts
// Rules specific to the French e-invoicing reform (DGFiP specifications
// externes B2B), applied on top of EN 16931.
//
// These are *national* restrictions, not EN 16931 ones. BT-23 is an EN 16931
// business term whose values the standard does not restrict — Peppol uses
// `urn:fdc:peppol.eu:…`, Chorus Pro uses A1/A2 — so enforcing the French list
// universally would lock out non-French callers and break round-tripping of any
// third-party document. Hence: opt-in. See validateEn16931's options.

import type { FacturXInvoice, ValidationError, ValidationErrorCode } from '../types/index.js';

/**
 * BT-23 cadre de facturation, closed list from rule G1.02.
 *
 * First letter is the operation category (Bien / Service / Mixte), the digit is
 * the invoicing situation. There is no "goods and services" code outside the M
 * family.
 */
export const BUSINESS_PROCESS_CODES: Readonly<Record<string, string>> = {
  B1: "dépôt d'une facture de bien",
  S1: "dépôt d'une facture de prestation de service",
  M1: 'dépôt d\'une facture double (biens et services)',
  B2: 'facture de bien déjà payée',
  S2: 'facture de prestation de service déjà payée',
  M2: 'facture double déjà payée',
  B4: 'facture définitive (après acompte) de bien',
  S4: 'facture définitive (après acompte) de service',
  M4: 'facture définitive (après acompte) double',
  S5: "dépôt par un sous-traitant d'une facture de prestation de service",
  S6: "dépôt par un cotraitant d'une facture de prestation de service",
  B7: 'facture de bien ayant fait l\'objet d\'un e-reporting',
  S7: "facture de service ayant fait l'objet d'un e-reporting",
};

/** Rule G1.60: a "facture définitive après acompte" cannot itself be a down-payment document. */
const FINAL_INVOICE_PROCESSES: readonly string[] = ['B4', 'S4', 'M4'];
const DOWN_PAYMENT_TYPE_CODES: readonly string[] = ['386', '500', '503'];

export function validateFrenchBusinessProcess(invoice: FacturXInvoice, errors: ValidationError[]): void {
  const code = invoice.businessProcess;

  // BT-23 is 1..1 in the French specifications, in both the Base and Full PPF
  // control profiles, from the DEMARRAGE trajectory onwards.
  if (code === undefined || code.trim() === '') {
    errors.push(
      error(
        'businessProcess',
        'MISSING_BUSINESS_PROCESS',
        'Le cadre de facturation (BT-23) est obligatoire pour la réforme française (G1.02)',
      ),
    );
    return;
  }

  // Object.hasOwn, not `in`: `in` walks Object.prototype, so a closed list
  // checked with `in` would admit "constructor", "valueOf", "hasOwnProperty".
  if (!Object.hasOwn(BUSINESS_PROCESS_CODES, code)) {
    errors.push(
      error(
        'businessProcess',
        'INVALID_BUSINESS_PROCESS',
        `Cadre de facturation « ${code} » hors de la liste fermée G1.02 (${Object.keys(BUSINESS_PROCESS_CODES).join(', ')})`,
      ),
    );
    return;
  }

  // G1.60 — a cross-constraint with BT-3 that neither the XSD nor the EN 16931
  // Schematron can see, so without this check the first signal would be a
  // rejection by the platform.
  if (FINAL_INVOICE_PROCESSES.includes(code) && DOWN_PAYMENT_TYPE_CODES.includes(invoice.typeCode)) {
    errors.push(
      error(
        'typeCode',
        'FORBIDDEN_TYPE_CODE_FOR_BUSINESS_PROCESS',
        `Le cadre ${code} désigne une facture définitive après acompte : le type de facture ${invoice.typeCode} est interdit (G1.60)`,
      ),
    );
  }
}

/**
 * Rule S1.13 — when BG-23 is repeated, BT-8 must carry the same value throughout.
 *
 * EN 16931 itself allows differing codes per breakdown; this is a French
 * restriction only.
 */
export function validateUniformVatPointDate(invoice: FacturXInvoice, errors: ValidationError[]): void {
  // Entries carrying *no* code must count. Filtering them out would hide the
  // likeliest real violation: one BG-23 with a code and one without serializes
  // ram:DueDateTypeCode on only some of the groups, which S1.13 forbids just as
  // much as two different codes do.
  const codes = new Set(invoice.taxBreakdown.map((tb) => tb.dueDateTypeCode ?? invoice.taxDueDateTypeCode));

  if (codes.size > 1) {
    const rendered = [...codes].map((c) => c ?? '(absent)').sort().join(', ');
    errors.push(
      error(
        'taxBreakdown',
        'INCONSISTENT_VAT_POINT_DATE',
        `Codes d'exigibilité TVA (BT-8) divergents dans un même document : ${rendered} — chaque BG-23 doit porter la même valeur (S1.13)`,
      ),
    );
  }
}

function error(field: string, code: ValidationErrorCode, message: string): ValidationError {
  return { field, code, message };
}
