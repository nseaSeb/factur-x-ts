// src/index.ts
// Public API of factur-x-ts

export type {
  FacturXInvoice,
  ParsedInvoice,
  DecimalInput,
  DeliveryParty,
  CurrencyCode,
  DocumentTypeCode,
  TradeParty,
  PostalAddress,
  TradeContact,
  LineItem,
  VatCategoryCode,
  AllowanceCharge,
  TaxBreakdown,
  MonetaryTotals,
  Note,
  BillingPeriod,
  PaymentMean,
  PrecedingInvoice,
  ParseResult,
  ExtractResult,
  GenerateOptions,
  GenerateFromInvoiceOptions,
  GenerateFromXmlOptions,
  FacturXMetadata,
  DraftInvoice,
  DraftLineItem,
  DraftTaxBreakdown,
  TotalsError,
  TotalsErrorCode,
  TotalsOptions,
  TotalsResult,
} from './types/index.js';
export { Profile, atLeast } from './types/index.js';

export type {
  ValidationError,
  ValidationErrorCode,
  ValidationOptions,
  ValidationResult,
  XsdValidationError,
  XsdValidationResult,
  XsdValidationOptions,
  SchematronViolation,
  SchematronValidationResult,
  SchematronValidationOptions,
} from './types/index.js';
export { validateEn16931, validateDecimals, VAT_POINT_DATE_CODES } from './profiles/en16931.js';
export { normalizeInvoice, type NormalizeResult, type DecimalError } from './normalize.js';
export type { DecimalRefusal } from './decimal.js';
export { computeTotals } from './totals.js';
export { BUSINESS_PROCESS_CODES } from './profiles/fr.js';
export { validateXsd, FacturXXsdNotBundledError } from './validate/xsd.js';
export {
  validateSchematron,
  FacturXSchematronNotBundledError,
  FacturXSaxonError,
} from './validate/schematron.js';
export { FacturXProfileNotDetectedError } from './validate/shared.js';

export { parse, extract, FacturXParseError, type FacturXParseErrorCode } from './pdf/parser.js';
export { generate, FacturXGenerateError, type FacturXGenerateErrorCode } from './pdf/generator.js';
export { serialize, FacturXSerializeError } from './xml/serializer.js';
export { deserialize, FacturXDeserializeError } from './xml/deserializer.js';
export { detectProfile, detectInvoiceNumber } from './xml/guideline.js';
export type { FacturXAttachmentName } from './pdf/filespec.js';
