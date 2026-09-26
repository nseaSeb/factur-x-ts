// src/profiles/en16931.ts
// EN 16931 mandatory-field and core business-rule validation.

import type { AllowanceCharge, FacturXInvoice, LineItem, ParsedInvoice, TaxBreakdown, VatCategoryCode } from '../types/invoice.js';
import type {
  ValidationError,
  ValidationErrorCode,
  ValidationOptions,
  ValidationResult,
} from '../types/validation.js';
import { abs, add, cmp, dec, eq, mul, percentOf, round, sign, sub, sum, toFixed, ZERO, type Decimal } from '../decimal.js';
import { normalizeInvoice } from '../normalize.js';
import { atLeast, type Profile } from '../types/profiles.js';
import { validateFrenchBusinessProcess, validateFrenchLegalIds, validateUniformVatPointDate } from './fr.js';

export type { ValidationError, ValidationErrorCode, ValidationOptions, ValidationResult };

// BR-CO-17's tolerance, read off the official EN 16931 Schematron
// (Factur-X_1.09_EN16931.xsl): `abs(CalculatedAmount) - 1 <= expected` and
// `abs(CalculatedAmount) + 1 >= expected`, where `expected` is
// basisAmount × rate / 100 rounded to 2 decimals. The `1` there is a full
// currency unit, not a cent — looks like a typo until you check the source,
// so don't "fix" it to 0.01.
const VAT_CALCULATION_TOLERANCE: Decimal = { units: 1n, scale: 0 };

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
  const { validateVatPointDate = true, validateFrenchRules = false } = options;
  const errors: ValidationError[] = [];

  if (validateVatPointDate) validateVatPointDateCodes(invoice, errors);
  if (validateFrenchRules) {
    validateFrenchBusinessProcess(invoice, errors);
    validateUniformVatPointDate(invoice, errors);
    validateFrenchLegalIds(invoice, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Every amount, quantity and rate is a decimal: finite, well-formed, and — for
 * a number — free of float drift. Reported as `INVALID_DECIMAL`, one error per
 * field. The other rules can only run on an invoice that passes this.
 */
export function validateDecimals(invoice: FacturXInvoice): ValidationResult {
  const normalized = normalizeInvoice(invoice);
  const errors = normalized.ok ? [] : normalized.errors.map((e) => field(e.field, 'INVALID_DECIMAL', e.message));
  return { valid: errors.length === 0, errors };
}

export function validateEn16931(source: FacturXInvoice, options: ValidationOptions = {}): ValidationResult {
  const normalized = normalizeInvoice(source);
  if (!normalized.ok) return validateDecimals(source);
  const invoice = normalized.invoice;
  const errors: ValidationError[] = [];

  if (invoice.number.trim() === '') {
    errors.push(field('number', 'EMPTY_VALUE', 'Invoice number (BT-1) must not be empty'));
  }
  if (invoice.seller.name.trim() === '') {
    errors.push(field('seller.name', 'EMPTY_VALUE', 'Seller name (BT-27) must not be empty'));
  }
  // BG-5 / BG-8 are optional on the model — MINIMUM has no buyer address —
  // but both are required at EN 16931 (BR-08 / BR-10).
  if (invoice.seller.address === undefined) {
    errors.push(field('seller.address', 'MISSING_FIELD', 'Seller postal address (BG-5) is required (BR-08)'));
  } else if (invoice.seller.address.country.trim() === '') {
    errors.push(field('seller.address.country', 'EMPTY_VALUE', 'Seller country (BT-40) must not be empty'));
  }
  if (invoice.buyer.name.trim() === '') {
    errors.push(field('buyer.name', 'EMPTY_VALUE', 'Buyer name (BT-44) must not be empty'));
  }
  if (invoice.buyer.address === undefined) {
    errors.push(field('buyer.address', 'MISSING_FIELD', 'Buyer postal address (BG-8) is required (BR-10)'));
  } else if (invoice.buyer.address.country.trim() === '') {
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
  validatePaymentTerms(invoice, errors);

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

function validateLine(line: LineItem<string>, index: number, errors: ValidationError[]): void {
  const prefix = `lines[${index}]`;
  const vatRate = dec(line.vatRate);

  if (line.name.trim() === '') {
    errors.push(field(`${prefix}.name`, 'EMPTY_VALUE', `Line ${line.id}: item name (BT-153) must not be empty`));
  }
  if (ZERO_RATE_CATEGORIES.includes(line.vatCategory) && sign(vatRate) !== 0) {
    errors.push(
      field(`${prefix}.vatRate`, 'INVALID_VAT_RATE', `Line ${line.id}: VAT category ${line.vatCategory} requires a 0% rate (BR-${line.vatCategory}-1)`),
    );
  }
  if (line.vatCategory === 'S' && sign(vatRate) <= 0) {
    errors.push(field(`${prefix}.vatRate`, 'INVALID_VAT_RATE', `Line ${line.id}: VAT category S (standard rate) requires a rate above 0% (BR-S-1)`));
  }

  // BT-146 (netPrice) already reflects any price discount (BT-147/148, folded
  // in before serialization) — the allowances/charges reconciled here are the
  // separate BG-27/BG-28 groups applied on top of quantity × net price to get
  // BT-131 (lineTotal). EN 16931 doesn't assert this with its own BR number
  // (unlike the header-level sums, BR-CO-10/13/14/15/16), so none is cited.
  //
  // Unlike those header sums, this one keeps a tolerance of a cent per unit:
  // a caller may state a net price with more decimals than the wire's four,
  // or a line total rounded per unit rather than once, and both are
  // legitimate. The tolerance absorbs that rounding without masking a
  // genuinely wrong lineTotal.
  const expectedLineTotal = add(
    sub(mul(dec(line.netPrice), dec(line.quantity)), sumOf(line.allowances)),
    sumOf(line.charges),
  );
  // abs, not the raw signed quantity: a credit/return line legitimately
  // carries a negative quantity.
  const quantity = abs(dec(line.quantity));
  const lineTotalTolerance = mul(CENT, cmp(quantity, ONE) > 0 ? quantity : ONE);
  if (cmp(abs(sub(expectedLineTotal, dec(line.lineTotal))), lineTotalTolerance) > 0) {
    errors.push(
      field(
        `${prefix}.lineTotal`,
        'AMOUNT_MISMATCH',
        `Line ${line.id}: lineTotal (${toFixed(dec(line.lineTotal), 2)}) does not equal quantity × net price adjusted by line-level allowances/charges (${toFixed(expectedLineTotal, 2)})`,
      ),
    );
  }
}

function validateTaxBreakdown(tb: TaxBreakdown<string>, index: number, errors: ValidationError[]): void {
  const prefix = `taxBreakdown[${index}]`;
  const rate = dec(tb.rate);

  if (ZERO_RATE_CATEGORIES.includes(tb.category) && sign(rate) !== 0) {
    errors.push(field(`${prefix}.rate`, 'INVALID_VAT_RATE', `VAT breakdown category ${tb.category} requires a 0% rate (BR-${tb.category}-1)`));
  }
  if (tb.category === 'S' && sign(rate) <= 0) {
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

  const expectedCalculatedAmount = round(percentOf(abs(dec(tb.basisAmount)), rate), 2);
  if (cmp(abs(sub(abs(dec(tb.calculatedAmount)), expectedCalculatedAmount)), VAT_CALCULATION_TOLERANCE) > 0) {
    errors.push(
      field(
        `${prefix}.calculatedAmount`,
        'AMOUNT_MISMATCH',
        `VAT breakdown category ${tb.category}: calculatedAmount (${toFixed(dec(tb.calculatedAmount), 2)}) does not match basisAmount × rate / 100 (${toFixed(expectedCalculatedAmount, 2)}), within a 1-unit tolerance (BR-CO-17)`,
      ),
    );
  }
}

function validateTaxBreakdownCoversLines(invoice: ParsedInvoice, errors: ValidationError[]): void {
  invoice.lines.forEach((line, index) => {
    // By value: "20" and "20.00" are the same rate.
    const covered = invoice.taxBreakdown.some((tb) => tb.category === line.vatCategory && eq(dec(tb.rate), dec(line.vatRate)));
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

function validateAmounts(invoice: ParsedInvoice, errors: ValidationError[]): void {
  const { totals } = invoice;
  const optional = (value: string | undefined): Decimal => (value === undefined ? ZERO : dec(value));

  // BT-106 is optional on the model because MINIMUM has no such element; at
  // EN 16931 it is mandatory, and the two sums built on it are skipped rather
  // than reported as mismatches against a figure that is simply absent.
  const { lineTotal } = totals;
  if (lineTotal === undefined) {
    errors.push(field('totals.lineTotal', 'MISSING_FIELD', 'totals.lineTotal (BT-106) is required (BR-CO-10)'));
  } else {
    const lineTotalSum = sum(invoice.lines.map((line) => dec(line.lineTotal)));
    if (!sameCents(lineTotalSum, dec(lineTotal))) {
      errors.push(
        field('totals.lineTotal', 'AMOUNT_MISMATCH', `Sum of line totals (${toFixed(lineTotalSum, 2)}) does not match totals.lineTotal (BR-CO-10)`),
      );
    }

    const expectedTaxBasisTotal = add(sub(dec(lineTotal), optional(totals.allowanceTotal)), optional(totals.chargeTotal));
    if (!sameCents(expectedTaxBasisTotal, dec(totals.taxBasisTotal))) {
      errors.push(field('totals.taxBasisTotal', 'AMOUNT_MISMATCH', 'taxBasisTotal must equal lineTotal - allowanceTotal + chargeTotal (BR-CO-13)'));
    }
  }

  // BT-107/BT-108 are the sums of the document-level BG-20/BG-21 groups. Without
  // this rule a non-zero total with no groups behind it passes here and is then
  // rejected by the receiver's Schematron (BR-CO-11/BR-CO-12).
  validateAllowanceChargeTotal(invoice.allowances, totals.allowanceTotal, 'allowance', 'BR-CO-11', errors);
  validateAllowanceChargeTotal(invoice.charges, totals.chargeTotal, 'charge', 'BR-CO-12', errors);

  const taxBreakdownSum = sum(invoice.taxBreakdown.map((tb) => dec(tb.calculatedAmount)));
  if (!sameCents(taxBreakdownSum, dec(totals.taxTotal))) {
    errors.push(
      field('totals.taxTotal', 'AMOUNT_MISMATCH', `Sum of VAT breakdown amounts (${toFixed(taxBreakdownSum, 2)}) does not match totals.taxTotal (BR-CO-14)`),
    );
  }

  const expectedGrandTotal = add(dec(totals.taxBasisTotal), dec(totals.taxTotal));
  if (!sameCents(expectedGrandTotal, dec(totals.grandTotal))) {
    errors.push(field('totals.grandTotal', 'AMOUNT_MISMATCH', 'grandTotal must equal taxBasisTotal + taxTotal (BR-CO-15)'));
  }

  const expectedDuePayable = sub(dec(totals.grandTotal), optional(totals.prepaid));
  if (!sameCents(expectedDuePayable, dec(totals.duePayable))) {
    errors.push(field('totals.duePayable', 'AMOUNT_MISMATCH', 'duePayable must equal grandTotal - prepaid (BR-CO-16)'));
  }
}

function validateAllowanceChargeTotal(
  groups: readonly AllowanceCharge<string>[] | undefined,
  declaredTotal: string | undefined,
  kind: 'allowance' | 'charge',
  rule: string,
  errors: ValidationError[],
): void {
  const groupSum = sumOf(groups);
  const total = declaredTotal === undefined ? ZERO : dec(declaredTotal);

  if (sameCents(groupSum, total)) return;

  const fieldName = `totals.${kind}Total`;
  const message =
    (groups ?? []).length === 0
      ? `totals.${kind}Total is ${toFixed(total, 2)} but the invoice declares no document-level ${kind}s (${rule})`
      : `Sum of document-level ${kind}s (${toFixed(groupSum, 2)}) does not match totals.${kind}Total (${rule})`;

  errors.push(field(fieldName, 'AMOUNT_MISMATCH', message));
}

// BR-CO-25 (asserted by the EXTENDED Schematron; EN 16931's doesn't carry it,
// but the underlying CII field and rounded-total semantics are shared, so
// checking it universally here is still correct — never a false positive).
function validatePaymentTerms(invoice: ParsedInvoice, errors: ValidationError[]): void {
  // Exact decimals: a zero due amount is exactly zero, with no float residue
  // to snap away first.
  if (sign(dec(invoice.totals.duePayable)) <= 0) return;
  // Truthy, not just !== undefined: buildPaymentTerms only emits ram:Description
  // for a non-empty string, so an empty paymentTerms would pass here but leave
  // the wire XML without a ram:Description for BR-CO-25's own XPath to find.
  if (invoice.paymentDueDate !== undefined || invoice.paymentTerms) return;

  errors.push(
    field(
      'paymentDueDate',
      'MISSING_PAYMENT_TERMS',
      'duePayable is positive: paymentDueDate (BT-9) or paymentTerms (BT-20) is required (BR-CO-25)',
    ),
  );
}

const CENT: Decimal = { units: 1n, scale: 2 };
const ONE: Decimal = { units: 1n, scale: 0 };

/** Equality as the Schematron sees it: both sides rounded to cents, then compared exactly. */
function sameCents(a: Decimal, b: Decimal): boolean {
  return eq(round(a, 2), round(b, 2));
}

function sumOf(groups: readonly { readonly amount: string }[] | undefined): Decimal {
  return sum((groups ?? []).map((g) => dec(g.amount)));
}

function field(fieldName: string, code: ValidationErrorCode, message: string): ValidationError {
  return { field: fieldName, code, message };
}


/**
 * What a profile's own XSD requires, for the profiles `validateEn16931` does
 * not cover.
 *
 * `generate` runs the full EN 16931 rule set for `EN 16931` only — the reduced
 * profiles legitimately omit fields it requires — but "reduced" is not
 * "anything goes": three elements have no `minOccurs="0"` in the BASIC WL and
 * BASIC schemas, and a document missing them is not a lax invoice but an
 * invalid one. Read off the bundled schemas, not assumed.
 *
 * This matters because the reduced profiles are now reachable from data this
 * library itself produces: `parse` on a MINIMUM PDF yields an invoice with no
 * `totals.lineTotal` and an empty `taxBreakdown`, and re-generating that at
 * BASIC WL would otherwise write an XSD-invalid PDF without a word.
 */
export function validateProfileStructure(invoice: FacturXInvoice, profile: Profile): ValidationResult {
  const errors: ValidationError[] = [];

  // MINIMUM's summation has no ram:LineTotalAmount and its settlement no
  // ram:ApplicableTradeTax at all, so neither is required there.
  if (atLeast(profile, 'BASIC WL')) {
    if (invoice.totals.lineTotal === undefined) {
      errors.push(
        field('totals.lineTotal', 'MISSING_FIELD', `totals.lineTotal (BT-106) is mandatory in the ${profile} schema`),
      );
    }
    if (invoice.taxBreakdown.length === 0) {
      errors.push(
        field('taxBreakdown', 'NO_TAX_BREAKDOWN', `The ${profile} schema requires at least one VAT breakdown group (BG-23)`),
      );
    }
  }

  // BASIC WL is "without lines" — the element does not exist there.
  if (atLeast(profile, 'BASIC') && invoice.lines.length === 0) {
    errors.push(field('lines', 'NO_LINES', `The ${profile} schema requires at least one line (BG-25)`));
  }

  return { valid: errors.length === 0, errors };
}
