// src/profiles/en16931.ts
// EN 16931 mandatory-field and core business-rule validation.

import type { AllowanceCharge, FacturXInvoice, LineItem, TaxBreakdown, VatCategoryCode } from '../types/invoice.js';
import type {
  ValidationError,
  ValidationErrorCode,
  ValidationOptions,
  ValidationResult,
} from '../types/validation.js';
import { validateFrenchBusinessProcess, validateUniformVatPointDate } from './fr.js';

export type { ValidationError, ValidationErrorCode, ValidationOptions, ValidationResult };

/**
 * BT-8, restricted by EN 16931 (BR-CL-06) to this subset of UNTDID 2475.
 *
 * The codes 3 / 35 / 432 seen widely quoted belong to UNTDID 2005, which is the
 * UBL subset. Emitted in CII they pass the XSD — `qdt:TimeReferenceCodeType` is
 * an unenumerated `xs:token` — and are then rejected by the Schematron.
 */
export const VAT_POINT_DATE_CODES: Readonly<Record<string, string>> = {
  '5': 'date de la facture (TVA sur les débits)',
  '29': 'date de livraison (livraison de biens)',
  '72': 'date de paiement (TVA à l\'encaissement)',
};

// Amounts are 2-decimal EN 16931 values; this tolerance absorbs independent
// per-line/per-breakdown rounding without masking genuine mismatches.
const AMOUNT_TOLERANCE = 0.02;

// Categories where EN 16931 (BR-Z/E/G/O/K/AE-*) requires a 0% rate.
const ZERO_RATE_CATEGORIES: readonly VatCategoryCode[] = ['Z', 'E', 'G', 'O', 'K', 'AE'];
// Categories where a VAT exemption reason (text or code) must be given at breakdown level.
const EXEMPTION_REQUIRED_CATEGORIES: readonly VatCategoryCode[] = ['E', 'O', 'AE'];

/**
 * The rules that do not depend on the Factur-X profile: BT-8 code validity
 * (BR-CL-06) and, opt-in, the French BT-23 rules.
 *
 * These live in the same CII elements in every profile and `serialize` emits
 * them regardless, so they are worth checking even for MINIMUM or BASIC WL —
 * where the full EN 16931 mandatory-field set would raise false errors, those
 * profiles legitimately omitting fields it requires.
 */
export function validateCodeLists(invoice: FacturXInvoice, options: ValidationOptions = {}): ValidationResult {
  const { validateVatPointDate = true, validateBusinessProcess = false } = options;
  const errors: ValidationError[] = [];

  if (validateVatPointDate) validateVatPointDateCodes(invoice, errors);
  if (validateBusinessProcess) {
    validateFrenchBusinessProcess(invoice, errors);
    validateUniformVatPointDate(invoice, errors);
  }

  return { valid: errors.length === 0, errors };
}

export function validateEn16931(invoice: FacturXInvoice, options: ValidationOptions = {}): ValidationResult {
  const errors: ValidationError[] = [];

  if (invoice.number.trim() === '') {
    errors.push(field('number', 'EMPTY_VALUE', 'Invoice number (BT-1) must not be empty'));
  }
  if (invoice.seller.name.trim() === '') {
    errors.push(field('seller.name', 'EMPTY_VALUE', 'Seller name (BT-27) must not be empty'));
  }
  if (invoice.seller.address.country.trim() === '') {
    errors.push(field('seller.address.country', 'EMPTY_VALUE', 'Seller country (BT-40) must not be empty'));
  }
  if (invoice.buyer.name.trim() === '') {
    errors.push(field('buyer.name', 'EMPTY_VALUE', 'Buyer name (BT-44) must not be empty'));
  }
  if (invoice.buyer.address.country.trim() === '') {
    errors.push(field('buyer.address.country', 'EMPTY_VALUE', 'Buyer country (BT-55) must not be empty'));
  }

  if (invoice.lines.length === 0) {
    errors.push(field('lines', 'NO_LINES', 'An invoice must have at least one line (BG-25)'));
  }
  if (invoice.taxBreakdown.length === 0) {
    errors.push(field('taxBreakdown', 'NO_TAX_BREAKDOWN', 'An invoice must have at least one VAT breakdown group (BG-23)'));
  }

  invoice.lines.forEach((line, index) => {
    validateLine(line, index, errors);
  });
  invoice.taxBreakdown.forEach((tb, index) => {
    validateTaxBreakdown(tb, index, errors);
  });
  validateTaxBreakdownCoversLines(invoice, errors);
  validateAmounts(invoice, errors);

  errors.push(...validateCodeLists(invoice, options).errors);

  return { valid: errors.length === 0, errors };
}

/** BR-CL-06, plus the case where a document-level BT-8 has nowhere to be emitted. */
function validateVatPointDateCodes(invoice: FacturXInvoice, errors: ValidationError[]): void {
  const documentCode = invoice.taxDueDateTypeCode;

  // A document-level code with no BG-23 to carry it would be dropped in silence
  // by the serializer. Losing a VAT point-date is not an acceptable no-op.
  if (documentCode !== undefined && invoice.taxBreakdown.length === 0) {
    errors.push(
      field(
        'taxDueDateTypeCode',
        'UNEMITTABLE_VAT_POINT_DATE',
        `taxDueDateTypeCode ${documentCode} cannot be emitted: BT-8 lives inside ram:ApplicableTradeTax and there is no VAT breakdown group`,
      ),
    );
  }

  // Object.hasOwn, not `in`: `in` resolves through Object.prototype, so a code of
  // "toString" or "valueOf" would pass a closed-list check. Reachable from parsed
  // third-party XML, since qdt:TimeReferenceCodeType is an unenumerated xs:token.
  if (documentCode !== undefined && !Object.hasOwn(VAT_POINT_DATE_CODES, documentCode)) {
    errors.push(invalidVatPointDate('taxDueDateTypeCode', documentCode));
  }

  invoice.taxBreakdown.forEach((tb, index) => {
    if (tb.dueDateTypeCode !== undefined && !Object.hasOwn(VAT_POINT_DATE_CODES, tb.dueDateTypeCode)) {
      errors.push(invalidVatPointDate(`taxBreakdown[${index}].dueDateTypeCode`, tb.dueDateTypeCode));
    }
  });
}

function invalidVatPointDate(fieldName: string, code: string): ValidationError {
  return field(
    fieldName,
    'INVALID_VAT_POINT_DATE',
    `VAT point date code "${code}" is not one of ${Object.keys(VAT_POINT_DATE_CODES).join(' / ')} (BR-CL-06). Codes 3/35/432 belong to UNTDID 2005 and are valid in UBL only, not CII`,
  );
}

function validateLine(line: LineItem, index: number, errors: ValidationError[]): void {
  const prefix = `lines[${index}]`;

  if (line.name.trim() === '') {
    errors.push(field(`${prefix}.name`, 'EMPTY_VALUE', `Line ${line.id}: item name (BT-153) must not be empty`));
  }
  if (ZERO_RATE_CATEGORIES.includes(line.vatCategory) && line.vatRate !== 0) {
    errors.push(
      field(`${prefix}.vatRate`, 'INVALID_VAT_RATE', `Line ${line.id}: VAT category ${line.vatCategory} requires a 0% rate (BR-${line.vatCategory}-1)`),
    );
  }
  if (line.vatCategory === 'S' && line.vatRate <= 0) {
    errors.push(field(`${prefix}.vatRate`, 'INVALID_VAT_RATE', `Line ${line.id}: VAT category S (standard rate) requires a rate above 0% (BR-S-1)`));
  }
}

function validateTaxBreakdown(tb: TaxBreakdown, index: number, errors: ValidationError[]): void {
  const prefix = `taxBreakdown[${index}]`;

  if (ZERO_RATE_CATEGORIES.includes(tb.category) && tb.rate !== 0) {
    errors.push(field(`${prefix}.rate`, 'INVALID_VAT_RATE', `VAT breakdown category ${tb.category} requires a 0% rate (BR-${tb.category}-1)`));
  }
  if (tb.category === 'S' && tb.rate <= 0) {
    errors.push(field(`${prefix}.rate`, 'INVALID_VAT_RATE', 'VAT breakdown category S (standard rate) requires a rate above 0% (BR-S-1)'));
  }
  if (EXEMPTION_REQUIRED_CATEGORIES.includes(tb.category) && !tb.exemptionReason && !tb.exemptionReasonCode) {
    errors.push(
      field(
        `${prefix}.exemptionReason`,
        'MISSING_EXEMPTION_REASON',
        `VAT breakdown category ${tb.category} requires an exemption reason or reason code (BR-${tb.category}-2/3)`,
      ),
    );
  }
}

function validateTaxBreakdownCoversLines(invoice: FacturXInvoice, errors: ValidationError[]): void {
  invoice.lines.forEach((line, index) => {
    const covered = invoice.taxBreakdown.some((tb) => tb.category === line.vatCategory && tb.rate === line.vatRate);
    if (!covered) {
      errors.push(
        field(
          `lines[${index}].vatCategory`,
          'MISSING_TAX_BREAKDOWN_GROUP',
          `Line ${line.id}: no VAT breakdown group for category ${line.vatCategory} at rate ${line.vatRate}% (BR-CO-18)`,
        ),
      );
    }
  });

  if (invoice.taxBreakdown.some((tb) => tb.category === 'K') && !invoice.buyer.vatId) {
    errors.push(field('buyer.vatId', 'MISSING_BUYER_VAT_ID', 'VAT category K (intra-community) requires the buyer VAT identifier (BR-IC-*)'));
  }
}

function validateAmounts(invoice: FacturXInvoice, errors: ValidationError[]): void {
  const { totals } = invoice;

  const lineTotalSum = invoice.lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (!isClose(lineTotalSum, totals.lineTotal)) {
    errors.push(
      field('totals.lineTotal', 'AMOUNT_MISMATCH', `Sum of line totals (${lineTotalSum.toFixed(2)}) does not match totals.lineTotal (BR-CO-10)`),
    );
  }

  const expectedTaxBasisTotal = totals.lineTotal - (totals.allowanceTotal ?? 0) + (totals.chargeTotal ?? 0);
  if (!isClose(expectedTaxBasisTotal, totals.taxBasisTotal)) {
    errors.push(field('totals.taxBasisTotal', 'AMOUNT_MISMATCH', 'taxBasisTotal must equal lineTotal - allowanceTotal + chargeTotal (BR-CO-13)'));
  }

  // BT-107/BT-108 are the sums of the document-level BG-20/BG-21 groups. Without
  // this rule a non-zero total with no groups behind it passes here and is then
  // rejected by the receiver's Schematron (BR-CO-11/BR-CO-12).
  validateAllowanceChargeTotal(invoice.allowances, totals.allowanceTotal, 'allowance', 'BR-CO-11', errors);
  validateAllowanceChargeTotal(invoice.charges, totals.chargeTotal, 'charge', 'BR-CO-12', errors);

  const taxBreakdownSum = invoice.taxBreakdown.reduce((sum, tb) => sum + tb.calculatedAmount, 0);
  if (!isClose(taxBreakdownSum, totals.taxTotal)) {
    errors.push(
      field('totals.taxTotal', 'AMOUNT_MISMATCH', `Sum of VAT breakdown amounts (${taxBreakdownSum.toFixed(2)}) does not match totals.taxTotal (BR-CO-14)`),
    );
  }

  const expectedGrandTotal = totals.taxBasisTotal + totals.taxTotal;
  if (!isClose(expectedGrandTotal, totals.grandTotal)) {
    errors.push(field('totals.grandTotal', 'AMOUNT_MISMATCH', 'grandTotal must equal taxBasisTotal + taxTotal (BR-CO-15)'));
  }

  const expectedDuePayable = totals.grandTotal - (totals.prepaid ?? 0);
  if (!isClose(expectedDuePayable, totals.duePayable)) {
    errors.push(field('totals.duePayable', 'AMOUNT_MISMATCH', 'duePayable must equal grandTotal - prepaid (BR-CO-16)'));
  }
}

function validateAllowanceChargeTotal(
  groups: readonly AllowanceCharge[] | undefined,
  declaredTotal: number | undefined,
  kind: 'allowance' | 'charge',
  rule: string,
  errors: ValidationError[],
): void {
  const groupSum = (groups ?? []).reduce((sum, ac) => sum + ac.amount, 0);
  const total = declaredTotal ?? 0;

  if (isClose(groupSum, total)) return;

  const fieldName = `totals.${kind}Total`;
  const message =
    groupSum === 0
      ? `totals.${kind}Total is ${total.toFixed(2)} but the invoice declares no document-level ${kind}s (${rule})`
      : `Sum of document-level ${kind}s (${groupSum.toFixed(2)}) does not match totals.${kind}Total (${rule})`;

  errors.push(field(fieldName, 'AMOUNT_MISMATCH', message));
}

function isClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

function field(fieldName: string, code: ValidationErrorCode, message: string): ValidationError {
  return { field: fieldName, code, message };
}
