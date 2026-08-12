// src/xml/deserializer.ts
// CII XML (UN/CEFACT SCRDM D22B) → FacturXInvoice.

import { XMLParser } from 'fast-xml-parser';
import type {
  FacturXInvoice,
  TradeParty,
  PostalAddress,
  TradeContact,
  LineItem,
  AllowanceCharge,
  TaxBreakdown,
  MonetaryTotals,
  Note,
  BillingPeriod,
  PaymentMean,
  PrecedingInvoice,
  CurrencyCode,
  DocumentTypeCode,
  VatCategoryCode,
} from '../types/invoice.js';

export class FacturXDeserializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacturXDeserializeError';
  }
}

// ---- Shape produced by fast-xml-parser for this document (attributeNamePrefix '@_', textNodeName '#text') ----

interface TextNode {
  readonly '#text'?: string;
}

type AmountNode = string | (TextNode & { readonly '@_currencyID'?: string }) | undefined;
type DateTimeStringNode = string | (TextNode & { readonly '@_format'?: string }) | undefined;

interface ParsedDateTime {
  readonly DateTimeString?: DateTimeStringNode;
}

interface ParsedNote {
  readonly Content?: string;
  readonly SubjectCode?: string;
}

interface ParsedPostalAddress {
  readonly PostcodeCode?: string;
  readonly LineOne?: string;
  readonly LineTwo?: string;
  readonly LineThree?: string;
  readonly CityName?: string;
  readonly CountryID?: string;
}

interface ParsedTradeContact {
  readonly PersonName?: string;
  readonly TelephoneUniversalCommunication?: { readonly CompleteNumber?: string };
  readonly EmailURIUniversalCommunication?: { readonly URIID?: string };
}

interface ParsedTaxRegistration {
  readonly ID?: string | (TextNode & { readonly '@_schemeID'?: string });
}

interface ParsedTradeParty {
  readonly Name?: string;
  readonly DefinedTradeContact?: ParsedTradeContact;
  readonly PostalTradeAddress?: ParsedPostalAddress;
  readonly SpecifiedTaxRegistration?: ParsedTaxRegistration;
}

interface ParsedHeaderTradeAgreement {
  readonly SellerTradeParty?: ParsedTradeParty;
  readonly BuyerTradeParty?: ParsedTradeParty;
}

interface ParsedLineTradeTax {
  readonly CategoryCode?: string;
  readonly RateApplicablePercent?: string;
}

interface ParsedChargeIndicator {
  readonly Indicator?: string;
}

interface ParsedAllowanceCharge {
  readonly ChargeIndicator?: ParsedChargeIndicator;
  readonly CalculationPercent?: string;
  readonly BasisAmount?: AmountNode;
  readonly ActualAmount?: AmountNode;
  readonly ReasonCode?: string;
  readonly Reason?: string;
  readonly CategoryTradeTax?: ParsedLineTradeTax;
}

interface ParsedTradePrice {
  readonly ChargeAmount?: AmountNode;
  readonly AppliedTradeAllowanceCharge?: ParsedAllowanceCharge;
}

interface ParsedLineTradeAgreement {
  readonly GrossPriceProductTradePrice?: ParsedTradePrice;
  readonly NetPriceProductTradePrice?: ParsedTradePrice;
}

type QuantityNode = string | (TextNode & { readonly '@_unitCode'?: string }) | undefined;

interface ParsedLineTradeDelivery {
  readonly BilledQuantity?: QuantityNode;
}

interface ParsedLineTradeSettlement {
  readonly ApplicableTradeTax?: ParsedLineTradeTax;
  readonly SpecifiedTradeAllowanceCharge?: readonly ParsedAllowanceCharge[];
  readonly SpecifiedTradeSettlementLineMonetarySummation?: { readonly LineTotalAmount?: AmountNode };
}

interface ParsedLineItem {
  readonly AssociatedDocumentLineDocument?: { readonly LineID?: string };
  readonly SpecifiedTradeProduct?: { readonly Name?: string; readonly Description?: string };
  readonly SpecifiedLineTradeAgreement?: ParsedLineTradeAgreement;
  readonly SpecifiedLineTradeDelivery?: ParsedLineTradeDelivery;
  readonly SpecifiedLineTradeSettlement?: ParsedLineTradeSettlement;
}

interface ParsedPaymentMeans {
  readonly TypeCode?: string;
  readonly ApplicableTradeSettlementFinancialCard?: { readonly ID?: string; readonly CardholderName?: string };
  readonly PayerPartyDebtorFinancialAccount?: { readonly IBANID?: string };
  readonly PayeePartyCreditorFinancialAccount?: { readonly IBANID?: string; readonly AccountName?: string };
  readonly PayeeSpecifiedCreditorFinancialInstitution?: { readonly BICID?: string };
}

interface ParsedTradeTax {
  readonly CalculatedAmount?: AmountNode;
  readonly BasisAmount?: AmountNode;
  readonly CategoryCode?: string;
  readonly RateApplicablePercent?: string;
  readonly ExemptionReason?: string;
  readonly ExemptionReasonCode?: string;
  readonly DueDateTypeCode?: string;
}

interface ParsedBillingPeriod {
  readonly StartDateTime?: ParsedDateTime;
  readonly EndDateTime?: ParsedDateTime;
}

interface ParsedMonetarySummation {
  readonly LineTotalAmount?: AmountNode;
  readonly ChargeTotalAmount?: AmountNode;
  readonly AllowanceTotalAmount?: AmountNode;
  readonly TaxBasisTotalAmount?: AmountNode;
  readonly TaxTotalAmount?: AmountNode;
  readonly GrandTotalAmount?: AmountNode;
  readonly TotalPrepaidAmount?: AmountNode;
  readonly DuePayableAmount?: AmountNode;
}

interface ParsedReferencedDocument {
  readonly IssuerAssignedID?: string;
  readonly FormattedIssueDateTime?: ParsedDateTime;
}

interface ParsedHeaderTradeSettlement {
  readonly InvoiceCurrencyCode?: string;
  readonly SpecifiedTradeSettlementPaymentMeans?: readonly ParsedPaymentMeans[];
  readonly ApplicableTradeTax?: readonly ParsedTradeTax[];
  readonly BillingSpecifiedPeriod?: ParsedBillingPeriod;
  readonly SpecifiedTradeAllowanceCharge?: readonly ParsedAllowanceCharge[];
  readonly SpecifiedTradeSettlementHeaderMonetarySummation?: ParsedMonetarySummation;
  readonly InvoiceReferencedDocument?: readonly ParsedReferencedDocument[];
}

interface ParsedSupplyChainTradeTransaction {
  readonly IncludedSupplyChainTradeLineItem?: readonly ParsedLineItem[];
  readonly ApplicableHeaderTradeAgreement?: ParsedHeaderTradeAgreement;
  readonly ApplicableHeaderTradeSettlement?: ParsedHeaderTradeSettlement;
}

interface ParsedExchangedDocumentContext {
  readonly BusinessProcessSpecifiedDocumentContextParameter?: { readonly ID?: string };
}

interface ParsedExchangedDocument {
  readonly ID?: string;
  readonly TypeCode?: string;
  readonly IssueDateTime?: ParsedDateTime;
  readonly IncludedNote?: readonly ParsedNote[];
}

interface ParsedCrossIndustryInvoice {
  readonly ExchangedDocumentContext?: ParsedExchangedDocumentContext;
  readonly ExchangedDocument?: ParsedExchangedDocument;
  readonly SupplyChainTradeTransaction?: ParsedSupplyChainTradeTransaction;
}

interface ParsedRoot {
  readonly CrossIndustryInvoice?: ParsedCrossIndustryInvoice;
}

const ARRAY_PATHS = new Set<string>([
  'CrossIndustryInvoice.ExchangedDocument.IncludedNote',
  'CrossIndustryInvoice.SupplyChainTradeTransaction.IncludedSupplyChainTradeLineItem',
  'CrossIndustryInvoice.SupplyChainTradeTransaction.ApplicableHeaderTradeSettlement.SpecifiedTradeSettlementPaymentMeans',
  'CrossIndustryInvoice.SupplyChainTradeTransaction.ApplicableHeaderTradeSettlement.ApplicableTradeTax',
  'CrossIndustryInvoice.SupplyChainTradeTransaction.ApplicableHeaderTradeSettlement.InvoiceReferencedDocument',
  'CrossIndustryInvoice.SupplyChainTradeTransaction.ApplicableHeaderTradeSettlement.SpecifiedTradeAllowanceCharge',
  'CrossIndustryInvoice.SupplyChainTradeTransaction.IncludedSupplyChainTradeLineItem.SpecifiedLineTradeSettlement.SpecifiedTradeAllowanceCharge',
]);

const CURRENCY_CODES: readonly CurrencyCode[] = ['EUR', 'USD', 'GBP'];
const DOCUMENT_TYPE_CODES: readonly DocumentTypeCode[] = ['380', '381', '386', '500'];
const VAT_CATEGORY_CODES: readonly VatCategoryCode[] = ['S', 'E', 'Z', 'G', 'O', 'K', 'AE'];

export function deserialize(xml: string): FacturXInvoice {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    isArray: (_tagName, jPath) => ARRAY_PATHS.has(jPath),
  });

  const root = parser.parse(xml) as ParsedRoot;
  const cii = root.CrossIndustryInvoice;
  if (!cii) {
    throw new FacturXDeserializeError('Missing root element rsm:CrossIndustryInvoice');
  }

  const context = cii.ExchangedDocumentContext;
  const document = cii.ExchangedDocument;
  const transaction = cii.SupplyChainTradeTransaction;
  if (!document) throw new FacturXDeserializeError('Missing rsm:ExchangedDocument');
  if (!document.ID) throw new FacturXDeserializeError('Missing ram:ID in rsm:ExchangedDocument');
  if (!document.TypeCode) throw new FacturXDeserializeError('Missing ram:TypeCode in rsm:ExchangedDocument');
  if (!transaction) throw new FacturXDeserializeError('Missing rsm:SupplyChainTradeTransaction');

  const agreement = transaction.ApplicableHeaderTradeAgreement;
  const settlement = transaction.ApplicableHeaderTradeSettlement;
  if (!agreement?.SellerTradeParty) throw new FacturXDeserializeError('Missing ram:SellerTradeParty');
  if (!agreement.BuyerTradeParty) throw new FacturXDeserializeError('Missing ram:BuyerTradeParty');
  if (!settlement) throw new FacturXDeserializeError('Missing ram:ApplicableHeaderTradeSettlement');
  if (!settlement.InvoiceCurrencyCode) throw new FacturXDeserializeError('Missing ram:InvoiceCurrencyCode');
  if (!settlement.SpecifiedTradeSettlementHeaderMonetarySummation) {
    throw new FacturXDeserializeError('Missing ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  }

  const businessProcess = context?.BusinessProcessSpecifiedDocumentContextParameter?.ID;
  const notes = (document.IncludedNote ?? []).map(parseNote);
  const lines = (transaction.IncludedSupplyChainTradeLineItem ?? []).map(parseLineItem);
  const taxBreakdown = (settlement.ApplicableTradeTax ?? []).map(parseTaxBreakdown);
  const totals = parseMonetaryTotals(settlement.SpecifiedTradeSettlementHeaderMonetarySummation);
  const paymentMeans = (settlement.SpecifiedTradeSettlementPaymentMeans ?? []).map(parsePaymentMeans);
  const precedingInvoices = (settlement.InvoiceReferencedDocument ?? []).map(parsePrecedingInvoice);
  const billingPeriod = settlement.BillingSpecifiedPeriod
    ? parseBillingPeriod(settlement.BillingSpecifiedPeriod)
    : undefined;

  // Document-level BG-20/BG-21, split on the same ChargeIndicator predicate the
  // line-level groups use.
  const headerAllowancesCharges = settlement.SpecifiedTradeAllowanceCharge ?? [];
  const allowances = headerAllowancesCharges.filter((ac) => !isChargeIndicator(ac)).map(parseAllowanceCharge);
  const charges = headerAllowancesCharges.filter((ac) => isChargeIndicator(ac)).map(parseAllowanceCharge);

  return {
    number: document.ID,
    issueDate: requireDate(document.IssueDateTime, 'rsm:ExchangedDocument/ram:IssueDateTime'),
    currency: asCurrencyCode(settlement.InvoiceCurrencyCode),
    typeCode: asDocumentTypeCode(document.TypeCode),
    seller: parseTradeParty(agreement.SellerTradeParty),
    buyer: parseTradeParty(agreement.BuyerTradeParty),
    lines,
    taxBreakdown,
    totals,
    ...(allowances.length > 0 ? { allowances } : {}),
    ...(charges.length > 0 ? { charges } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(billingPeriod ? { billingPeriod } : {}),
    ...(paymentMeans.length > 0 ? { paymentMeans } : {}),
    ...(precedingInvoices.length > 0 ? { precedingInvoices } : {}),
    ...(businessProcess ? { businessProcess } : {}),
  };
}

// ---- Section parsers ----

function parseTradeParty(node: ParsedTradeParty): TradeParty {
  if (!node.Name) throw new FacturXDeserializeError('Missing ram:Name in trade party');
  const address = node.PostalTradeAddress;
  if (!address?.PostcodeCode || !address.LineOne || !address.CityName || !address.CountryID) {
    throw new FacturXDeserializeError(`Incomplete ram:PostalTradeAddress for ${node.Name}`);
  }

  const postalAddress: PostalAddress = {
    lineOne: address.LineOne,
    ...(address.LineTwo ? { lineTwo: address.LineTwo } : {}),
    ...(address.LineThree ? { lineThree: address.LineThree } : {}),
    postcode: address.PostcodeCode,
    city: address.CityName,
    country: address.CountryID,
  };

  const vatId = textOf(node.SpecifiedTaxRegistration?.ID);
  const contact = parseTradeContact(node.DefinedTradeContact);

  return {
    name: node.Name,
    ...(vatId ? { vatId } : {}),
    address: postalAddress,
    ...(contact ? { contact } : {}),
  };
}

function parseTradeContact(node: ParsedTradeContact | undefined): TradeContact | undefined {
  if (!node) return undefined;
  const phone = node.TelephoneUniversalCommunication?.CompleteNumber;
  const email = node.EmailURIUniversalCommunication?.URIID;
  if (!node.PersonName && !phone && !email) return undefined;

  return {
    ...(node.PersonName ? { name: node.PersonName } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  };
}

function parseLineItem(node: ParsedLineItem): LineItem {
  const id = node.AssociatedDocumentLineDocument?.LineID;
  const name = node.SpecifiedTradeProduct?.Name;
  const netPriceNode = node.SpecifiedLineTradeAgreement?.NetPriceProductTradePrice?.ChargeAmount;
  const quantityNode = node.SpecifiedLineTradeDelivery?.BilledQuantity;
  const lineTotalNode = node.SpecifiedLineTradeSettlement?.SpecifiedTradeSettlementLineMonetarySummation?.LineTotalAmount;
  const tax = node.SpecifiedLineTradeSettlement?.ApplicableTradeTax;

  if (!id) throw new FacturXDeserializeError('Missing ram:LineID in a line item');
  if (!name) throw new FacturXDeserializeError(`Missing ram:Name for line ${id}`);
  if (netPriceNode === undefined) throw new FacturXDeserializeError(`Missing NetPriceProductTradePrice for line ${id}`);
  if (lineTotalNode === undefined) throw new FacturXDeserializeError(`Missing LineTotalAmount for line ${id}`);
  if (!tax?.CategoryCode || !tax.RateApplicablePercent) {
    throw new FacturXDeserializeError(`Missing ApplicableTradeTax for line ${id}`);
  }

  const quantityText = textOf(quantityNode);
  const unit = typeof quantityNode === 'object' ? quantityNode['@_unitCode'] : undefined;
  if (quantityText === undefined || !unit) {
    throw new FacturXDeserializeError(`Missing BilledQuantity/unitCode for line ${id}`);
  }

  const grossPriceNode = node.SpecifiedLineTradeAgreement?.GrossPriceProductTradePrice;
  const grossPrice = grossPriceNode ? parseOptionalAmount(grossPriceNode.ChargeAmount) : undefined;
  const priceDiscount = grossPriceNode?.AppliedTradeAllowanceCharge
    ? parseOptionalAmount(grossPriceNode.AppliedTradeAllowanceCharge.ActualAmount)
    : undefined;

  const settlementAllowancesCharges = node.SpecifiedLineTradeSettlement?.SpecifiedTradeAllowanceCharge ?? [];
  const allowances = settlementAllowancesCharges.filter((ac) => !isChargeIndicator(ac)).map(parseAllowanceCharge);
  const charges = settlementAllowancesCharges.filter((ac) => isChargeIndicator(ac)).map(parseAllowanceCharge);

  const description = node.SpecifiedTradeProduct?.Description;

  return {
    id,
    name,
    ...(description ? { description } : {}),
    quantity: Number(quantityText),
    unit,
    netPrice: requireAmount(netPriceNode, `line ${id} NetPriceProductTradePrice`),
    ...(grossPrice !== undefined ? { grossPrice } : {}),
    ...(priceDiscount !== undefined ? { priceDiscount } : {}),
    lineTotal: requireAmount(lineTotalNode, `line ${id} LineTotalAmount`),
    vatCategory: asVatCategoryCode(tax.CategoryCode),
    vatRate: Number(tax.RateApplicablePercent),
    ...(allowances.length > 0 ? { allowances } : {}),
    ...(charges.length > 0 ? { charges } : {}),
  };
}

function isChargeIndicator(node: ParsedAllowanceCharge): boolean {
  return node.ChargeIndicator?.Indicator === 'true';
}

function parseAllowanceCharge(node: ParsedAllowanceCharge): AllowanceCharge {
  const category = node.CategoryTradeTax;
  if (node.ActualAmount === undefined) throw new FacturXDeserializeError('Missing ram:ActualAmount in allowance/charge');
  if (!category?.CategoryCode || !category.RateApplicablePercent) {
    throw new FacturXDeserializeError('Missing ram:CategoryTradeTax in allowance/charge');
  }

  const basisAmount = parseOptionalAmount(node.BasisAmount);
  const percent = node.CalculationPercent !== undefined ? Number(node.CalculationPercent) : undefined;

  return {
    amount: requireAmount(node.ActualAmount, 'allowance/charge ActualAmount'),
    ...(node.Reason ? { reason: node.Reason } : {}),
    ...(node.ReasonCode ? { reasonCode: node.ReasonCode } : {}),
    ...(basisAmount !== undefined ? { basisAmount } : {}),
    ...(percent !== undefined ? { percent } : {}),
    vatCategory: asVatCategoryCode(category.CategoryCode),
    vatRate: Number(category.RateApplicablePercent),
  };
}

function parseTaxBreakdown(node: ParsedTradeTax): TaxBreakdown {
  if (!node.CategoryCode || !node.RateApplicablePercent) {
    throw new FacturXDeserializeError('Incomplete header ram:ApplicableTradeTax');
  }
  if (node.BasisAmount === undefined || node.CalculatedAmount === undefined) {
    throw new FacturXDeserializeError('Missing tax breakdown amounts');
  }

  return {
    type: 'VAT',
    category: asVatCategoryCode(node.CategoryCode),
    rate: Number(node.RateApplicablePercent),
    basisAmount: requireAmount(node.BasisAmount, 'tax breakdown BasisAmount'),
    calculatedAmount: requireAmount(node.CalculatedAmount, 'tax breakdown CalculatedAmount'),
    ...(node.ExemptionReason ? { exemptionReason: node.ExemptionReason } : {}),
    ...(node.ExemptionReasonCode ? { exemptionReasonCode: node.ExemptionReasonCode } : {}),
    ...(node.DueDateTypeCode ? { dueDateTypeCode: node.DueDateTypeCode } : {}),
  };
}

function parseMonetaryTotals(node: ParsedMonetarySummation): MonetaryTotals {
  if (
    node.LineTotalAmount === undefined ||
    node.TaxBasisTotalAmount === undefined ||
    node.TaxTotalAmount === undefined ||
    node.GrandTotalAmount === undefined ||
    node.DuePayableAmount === undefined
  ) {
    throw new FacturXDeserializeError('Incomplete ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  }

  const allowanceTotal = parseOptionalAmount(node.AllowanceTotalAmount);
  const chargeTotal = parseOptionalAmount(node.ChargeTotalAmount);
  const prepaid = parseOptionalAmount(node.TotalPrepaidAmount);

  return {
    lineTotal: requireAmount(node.LineTotalAmount, 'LineTotalAmount'),
    ...(allowanceTotal !== undefined ? { allowanceTotal } : {}),
    ...(chargeTotal !== undefined ? { chargeTotal } : {}),
    taxBasisTotal: requireAmount(node.TaxBasisTotalAmount, 'TaxBasisTotalAmount'),
    taxTotal: requireAmount(node.TaxTotalAmount, 'TaxTotalAmount'),
    grandTotal: requireAmount(node.GrandTotalAmount, 'GrandTotalAmount'),
    ...(prepaid !== undefined ? { prepaid } : {}),
    duePayable: requireAmount(node.DuePayableAmount, 'DuePayableAmount'),
  };
}

function parseNote(node: ParsedNote): Note {
  if (!node.Content) throw new FacturXDeserializeError('Missing ram:Content in ram:IncludedNote');
  return {
    content: node.Content,
    ...(node.SubjectCode ? { subjectCode: node.SubjectCode } : {}),
  };
}

function parseBillingPeriod(node: ParsedBillingPeriod): BillingPeriod {
  return {
    startDate: requireDate(node.StartDateTime, 'ram:BillingSpecifiedPeriod/ram:StartDateTime'),
    endDate: requireDate(node.EndDateTime, 'ram:BillingSpecifiedPeriod/ram:EndDateTime'),
  };
}

function parsePaymentMeans(node: ParsedPaymentMeans): PaymentMean {
  if (!node.TypeCode) throw new FacturXDeserializeError('Missing ram:TypeCode in payment means');

  const iban = node.PayeePartyCreditorFinancialAccount?.IBANID;
  const accountName = node.PayeePartyCreditorFinancialAccount?.AccountName;
  const bic = node.PayeeSpecifiedCreditorFinancialInstitution?.BICID;
  const payerIban = node.PayerPartyDebtorFinancialAccount?.IBANID;
  const cardId = node.ApplicableTradeSettlementFinancialCard?.ID;
  const cardholderName = node.ApplicableTradeSettlementFinancialCard?.CardholderName;

  return {
    typeCode: node.TypeCode,
    ...(iban ? { iban } : {}),
    ...(accountName ? { accountName } : {}),
    ...(bic ? { bic } : {}),
    ...(payerIban ? { payerIban } : {}),
    ...(cardId ? { cardId } : {}),
    ...(cardholderName ? { cardholderName } : {}),
  };
}

function parsePrecedingInvoice(node: ParsedReferencedDocument): PrecedingInvoice {
  if (!node.IssuerAssignedID) {
    throw new FacturXDeserializeError('Missing ram:IssuerAssignedID in ram:InvoiceReferencedDocument');
  }
  const dateText = textOf(node.FormattedIssueDateTime?.DateTimeString);

  return {
    number: node.IssuerAssignedID,
    ...(dateText !== undefined ? { issueDate: parseDate102(dateText) } : {}),
  };
}

// ---- Primitives ----

function textOf<T extends TextNode>(node: string | T | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (typeof node === 'string') return node;
  return node['#text'];
}

function requireAmount(node: AmountNode, field: string): number {
  const value = parseOptionalAmount(node);
  if (value === undefined) throw new FacturXDeserializeError(`Missing or invalid amount: ${field}`);
  return value;
}

function parseOptionalAmount(node: AmountNode): number | undefined {
  const text = textOf(node);
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isNaN(value) ? undefined : value;
}

function requireDate(node: ParsedDateTime | undefined, field: string): Date {
  const text = textOf(node?.DateTimeString);
  if (text === undefined) throw new FacturXDeserializeError(`Missing or invalid date: ${field}`);
  return parseDate102(text);
}

function parseDate102(text: string): Date {
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day));
}

function asCurrencyCode(value: string): CurrencyCode {
  if ((CURRENCY_CODES as readonly string[]).includes(value)) return value as CurrencyCode;
  throw new FacturXDeserializeError(`Unsupported currency code: ${value}`);
}

function asDocumentTypeCode(value: string): DocumentTypeCode {
  if ((DOCUMENT_TYPE_CODES as readonly string[]).includes(value)) return value as DocumentTypeCode;
  throw new FacturXDeserializeError(`Unsupported document type code: ${value}`);
}

function asVatCategoryCode(value: string): VatCategoryCode {
  if ((VAT_CATEGORY_CODES as readonly string[]).includes(value)) return value as VatCategoryCode;
  throw new FacturXDeserializeError(`Unsupported VAT category code: ${value}`);
}
