// src/xml/deserializer.ts
// CII XML (UN/CEFACT SCRDM D22B) → FacturXInvoice.

import { XMLParser } from 'fast-xml-parser';
import { hasDoctype, stripBom } from './hygiene.js';
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

type SchemedIdNode = string | (TextNode & { readonly '@_schemeID'?: string });

interface ParsedTradeParty {
  readonly GlobalID?: SchemedIdNode;
  readonly Name?: string;
  readonly SpecifiedLegalOrganization?: { readonly ID?: SchemedIdNode };
  readonly DefinedTradeContact?: ParsedTradeContact;
  readonly PostalTradeAddress?: ParsedPostalAddress;
  readonly SpecifiedTaxRegistration?: ParsedTaxRegistration;
}

interface ParsedHeaderTradeAgreement {
  readonly SellerTradeParty?: ParsedTradeParty;
  readonly BuyerTradeParty?: ParsedTradeParty;
  readonly SellerTaxRepresentativeTradeParty?: ParsedTradeParty;
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

interface ParsedSupplyChainEvent {
  readonly OccurrenceDateTime?: ParsedDateTime;
}

interface ParsedLineTradeDelivery {
  readonly BilledQuantity?: QuantityNode;
  readonly ShipToTradeParty?: ParsedTradeParty;
  readonly ActualDeliverySupplyChainEvent?: ParsedSupplyChainEvent;
}

interface ParsedLineTradeSettlement {
  readonly ApplicableTradeTax?: ParsedLineTradeTax;
  readonly SpecifiedTradeAllowanceCharge?: readonly ParsedAllowanceCharge[];
  readonly SpecifiedTradeSettlementLineMonetarySummation?: { readonly LineTotalAmount?: AmountNode };
  readonly InvoiceReferencedDocument?: ParsedReferencedDocument;
}

interface ParsedLineItem {
  readonly AssociatedDocumentLineDocument?: { readonly LineID?: string; readonly IncludedNote?: readonly ParsedNote[] };
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

interface ParsedPaymentTerms {
  readonly Description?: string;
  readonly DueDateDateTime?: ParsedDateTime;
}

interface ParsedHeaderTradeSettlement {
  readonly InvoiceCurrencyCode?: string;
  readonly SpecifiedTradeSettlementPaymentMeans?: readonly ParsedPaymentMeans[];
  readonly ApplicableTradeTax?: readonly ParsedTradeTax[];
  readonly BillingSpecifiedPeriod?: ParsedBillingPeriod;
  readonly SpecifiedTradeAllowanceCharge?: readonly ParsedAllowanceCharge[];
  readonly SpecifiedTradePaymentTerms?: readonly ParsedPaymentTerms[];
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
  // EXTENDED's XSD (unlike EN 16931's) declares maxOccurs="unbounded" here,
  // for repeated installment terms; this library's model only carries one
  // paymentTerms/paymentDueDate pair, so a multi-instance document has its
  // first entry read (see below) rather than silently losing the field to
  // fast-xml-parser's non-array-by-default property access on an array.
  'CrossIndustryInvoice.SupplyChainTradeTransaction.ApplicableHeaderTradeSettlement.SpecifiedTradePaymentTerms',
  'CrossIndustryInvoice.SupplyChainTradeTransaction.IncludedSupplyChainTradeLineItem.SpecifiedLineTradeSettlement.SpecifiedTradeAllowanceCharge',
  // EN 16931 caps this at one occurrence with no SubjectCode; EXTENDED
  // allows unbounded (EXT-FR-FE-183) — see buildLineNotes in serializer.ts.
  'CrossIndustryInvoice.SupplyChainTradeTransaction.IncludedSupplyChainTradeLineItem.AssociatedDocumentLineDocument.IncludedNote',
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

  const text = stripBom(xml);
  // Third-party invoices come through here: an entity declaration would be
  // expanded by fast-xml-parser, so a DOCTYPE is refused before parsing.
  if (hasDoctype(text)) {
    throw new FacturXDeserializeError('XML carries a DOCTYPE declaration, which is refused (XXE / entity expansion)');
  }

  let root: ParsedRoot;
  try {
    root = parser.parse(text) as ParsedRoot;
  } catch (cause) {
    throw new FacturXDeserializeError(`XML is not well-formed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
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
  const { entries: taxBreakdown, documentCode: taxDueDateTypeCode } = normalizeVatPointDate(
    (settlement.ApplicableTradeTax ?? []).map(parseTaxBreakdown),
  );
  const totals = parseMonetaryTotals(settlement.SpecifiedTradeSettlementHeaderMonetarySummation);
  const paymentMeans = (settlement.SpecifiedTradeSettlementPaymentMeans ?? []).map(parsePaymentMeans);
  const precedingInvoices = (settlement.InvoiceReferencedDocument ?? []).map(parsePrecedingInvoice);
  const billingPeriod = settlement.BillingSpecifiedPeriod
    ? parseBillingPeriod(settlement.BillingSpecifiedPeriod)
    : undefined;
  // Only the first entry is read (see the ARRAY_PATHS comment above) — this
  // library's model has no way to represent more than one.
  const paymentTermsNode = settlement.SpecifiedTradePaymentTerms?.[0];
  const paymentTerms = paymentTermsNode?.Description;
  const paymentDueDateText = textOf(paymentTermsNode?.DueDateDateTime?.DateTimeString);

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
    ...(agreement.SellerTaxRepresentativeTradeParty
      ? { taxRepresentative: parseTradeParty(agreement.SellerTaxRepresentativeTradeParty) }
      : {}),
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
    ...(taxDueDateTypeCode !== undefined ? { taxDueDateTypeCode } : {}),
    ...(paymentTerms ? { paymentTerms } : {}),
    ...(paymentDueDateText !== undefined ? { paymentDueDate: parseDate102(paymentDueDateText) } : {}),
  };
}

/**
 * Lifts a uniform BT-8 back to the document level, reversibly.
 *
 * BT-8 lives inside each ram:ApplicableTradeTax, but the French rule S1.13
 * requires one value per document, which makes a single document-level field the
 * natural representation — the serializer copies it onto every entry.
 *
 * Reading it back per-entry only would be lossy in the other direction: a
 * document-level code would come back spread across the breakdown, so
 * `parse(generate(invoice))` would not equal `invoice`. Reading it back
 * document-level only would be worse — a legitimately divergent third-party
 * document (EN 16931 permits differing codes per entry) would round-trip
 * `29, 72` into `29, 29`, silently falsifying the VAT point date of the second
 * entry. Corrupting tax data without saying so is the worst option available.
 *
 * So: uniform code is lifted and stripped from the entries; divergent codes stay
 * where they are and no document-level field is produced.
 */
function normalizeVatPointDate(breakdown: TaxBreakdown[]): {
  readonly entries: TaxBreakdown[];
  readonly documentCode: string | undefined;
} {
  const codes = new Set(breakdown.map((tb) => tb.dueDateTypeCode));
  const uniform = breakdown.length > 0 && codes.size === 1 && !codes.has(undefined);

  if (!uniform) return { entries: breakdown, documentCode: undefined };

  return {
    entries: breakdown.map(({ dueDateTypeCode: _lifted, ...rest }) => rest),
    documentCode: breakdown[0]?.dueDateTypeCode,
  };
}

// ---- Section parsers ----

function parseTradeParty(node: ParsedTradeParty): TradeParty {
  if (!node.Name) throw new FacturXDeserializeError('Missing ram:Name in trade party');
  const address = node.PostalTradeAddress;
  // A party with no ram:PostalTradeAddress at all is legitimate: MINIMUM gives
  // one to the seller and to nobody else. One that *has* the element must
  // carry a country — only CountryID is mandatory in the CII schema and in
  // EN 16931's own Schematron (see PostalAddress in types/invoice.ts), so
  // requiring the rest would reject a document that only ever had a country.
  if (address !== undefined && !address.CountryID) {
    throw new FacturXDeserializeError(`Missing ram:PostalTradeAddress/ram:CountryID for ${node.Name}`);
  }

  const postalAddress: PostalAddress | undefined =
    address?.CountryID === undefined
      ? undefined
      : {
          ...(address.LineOne ? { lineOne: address.LineOne } : {}),
          ...(address.LineTwo ? { lineTwo: address.LineTwo } : {}),
          ...(address.LineThree ? { lineThree: address.LineThree } : {}),
          ...(address.PostcodeCode ? { postcode: address.PostcodeCode } : {}),
          ...(address.CityName ? { city: address.CityName } : {}),
          country: address.CountryID,
        };

  const vatId = textOf(node.SpecifiedTaxRegistration?.ID);
  const contact = parseTradeContact(node.DefinedTradeContact);

  const globalId = textOf(node.GlobalID);
  const globalScheme = schemeOf(node.GlobalID);
  const legalId = textOf(node.SpecifiedLegalOrganization?.ID);
  const legalScheme = schemeOf(node.SpecifiedLegalOrganization?.ID);

  return {
    name: node.Name,
    ...(vatId ? { vatId } : {}),
    ...(legalId ? { legalId } : {}),
    // The scheme comes back as written, not as supplied: the serializer applies
    // a default when none is given, so a party built with `legalId` alone
    // returns carrying `legalScheme: '0002'`. The document is unchanged; the
    // model is enriched with what the document actually says.
    ...(legalScheme ? { legalScheme } : {}),
    ...(globalId ? { globalId } : {}),
    ...(globalScheme ? { globalScheme } : {}),
    ...(postalAddress !== undefined ? { address: postalAddress } : {}),
    ...(contact ? { contact } : {}),
  };
}

/** schemeID attribute of an identifier node, if it carries one. */
function schemeOf(node: SchemedIdNode | undefined): string | undefined {
  return typeof node === 'object' ? node['@_schemeID'] : undefined;
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
  const grossPrice = grossPriceNode ? parseOptionalAmount(grossPriceNode.ChargeAmount, `line ${id} GrossPriceProductTradePrice ChargeAmount`) : undefined;
  const priceDiscount = grossPriceNode?.AppliedTradeAllowanceCharge
    ? parseOptionalAmount(grossPriceNode.AppliedTradeAllowanceCharge.ActualAmount, `line ${id} gross price discount`)
    : undefined;

  const settlementAllowancesCharges = node.SpecifiedLineTradeSettlement?.SpecifiedTradeAllowanceCharge ?? [];
  const allowances = settlementAllowancesCharges.filter((ac) => !isChargeIndicator(ac)).map(parseAllowanceCharge);
  const charges = settlementAllowancesCharges.filter((ac) => isChargeIndicator(ac)).map(parseAllowanceCharge);

  // Non-optional access: the `!name` guard above narrows SpecifiedTradeProduct
  // to defined. Moving that guard makes this a compile error, not a crash.
  const description = node.SpecifiedTradeProduct.Description;

  // EXTENDED-only fields (EXT-FR-FE-*, see LineItem in types/invoice.ts) —
  // read unconditionally here regardless of the document's own profile, the
  // same way taxRepresentative etc. are: parsing is profile-agnostic, only
  // serialize() gates emission by profile.
  const notes = (node.AssociatedDocumentLineDocument.IncludedNote ?? []).map(parseNote);
  const delivery = node.SpecifiedLineTradeDelivery;
  const shipTo = delivery?.ShipToTradeParty ? parseTradeParty(delivery.ShipToTradeParty) : undefined;
  const deliveryDate = delivery?.ActualDeliverySupplyChainEvent
    ? requireDate(
        delivery.ActualDeliverySupplyChainEvent.OccurrenceDateTime,
        `line ${id} ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime`,
      )
    : undefined;
  const linePrecedingInvoiceNode = node.SpecifiedLineTradeSettlement?.InvoiceReferencedDocument;
  const linePrecedingInvoice = linePrecedingInvoiceNode ? parsePrecedingInvoice(linePrecedingInvoiceNode) : undefined;

  return {
    id,
    name,
    ...(description ? { description } : {}),
    quantity: requireNumber(quantityText, `line ${id} BilledQuantity`),
    unit,
    netPrice: requireAmount(netPriceNode, `line ${id} NetPriceProductTradePrice`),
    ...(grossPrice !== undefined ? { grossPrice } : {}),
    ...(priceDiscount !== undefined ? { priceDiscount } : {}),
    lineTotal: requireAmount(lineTotalNode, `line ${id} LineTotalAmount`),
    vatCategory: asVatCategoryCode(tax.CategoryCode),
    vatRate: requireNumber(tax.RateApplicablePercent, `line ${id} RateApplicablePercent`),
    ...(allowances.length > 0 ? { allowances } : {}),
    ...(charges.length > 0 ? { charges } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(shipTo !== undefined ? { shipTo } : {}),
    ...(deliveryDate !== undefined ? { deliveryDate } : {}),
    ...(linePrecedingInvoice !== undefined ? { precedingInvoice: linePrecedingInvoice } : {}),
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

  const basisAmount = parseOptionalAmount(node.BasisAmount, 'allowance/charge BasisAmount');
  const percent = node.CalculationPercent !== undefined ? requireNumber(node.CalculationPercent, 'allowance/charge CalculationPercent') : undefined;

  return {
    amount: requireAmount(node.ActualAmount, 'allowance/charge ActualAmount'),
    ...(node.Reason ? { reason: node.Reason } : {}),
    ...(node.ReasonCode ? { reasonCode: node.ReasonCode } : {}),
    ...(basisAmount !== undefined ? { basisAmount } : {}),
    ...(percent !== undefined ? { percent } : {}),
    vatCategory: asVatCategoryCode(category.CategoryCode),
    vatRate: requireNumber(category.RateApplicablePercent, 'allowance/charge CategoryTradeTax RateApplicablePercent'),
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
    rate: requireNumber(node.RateApplicablePercent, 'tax breakdown RateApplicablePercent'),
    basisAmount: requireAmount(node.BasisAmount, 'tax breakdown BasisAmount'),
    calculatedAmount: requireAmount(node.CalculatedAmount, 'tax breakdown CalculatedAmount'),
    ...(node.ExemptionReason ? { exemptionReason: node.ExemptionReason } : {}),
    ...(node.ExemptionReasonCode ? { exemptionReasonCode: node.ExemptionReasonCode } : {}),
    ...(node.DueDateTypeCode ? { dueDateTypeCode: node.DueDateTypeCode } : {}),
  };
}

function parseMonetaryTotals(node: ParsedMonetarySummation): MonetaryTotals {
  // BT-106 is not in the required set: MINIMUM's summation carries four
  // amounts and no ram:LineTotalAmount, so demanding it here would make every
  // MINIMUM document unreadable. The four below are the ones every profile has.
  if (
    node.TaxBasisTotalAmount === undefined ||
    node.TaxTotalAmount === undefined ||
    node.GrandTotalAmount === undefined ||
    node.DuePayableAmount === undefined
  ) {
    throw new FacturXDeserializeError('Incomplete ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  }

  const lineTotal = parseOptionalAmount(node.LineTotalAmount, 'LineTotalAmount');
  const allowanceTotal = parseOptionalAmount(node.AllowanceTotalAmount, 'AllowanceTotalAmount');
  const chargeTotal = parseOptionalAmount(node.ChargeTotalAmount, 'ChargeTotalAmount');
  const prepaid = parseOptionalAmount(node.TotalPrepaidAmount, 'TotalPrepaidAmount');

  return {
    ...(lineTotal !== undefined ? { lineTotal } : {}),
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

function textOf(node: string | TextNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (typeof node === 'string') return node;
  return node['#text'];
}

// xsd:decimal's lexical space, and nothing wider: no exponent ("1e400" is
// Infinity to Number()), no hex ("0x10" is 16), no "Infinity"/"NaN", no
// thousands or decimal comma. Number() accepts all of those, and every one of
// them would enter the model as a plausible-looking figure.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
// No real amount, quantity or rate needs more; a longer string is refused
// before anything computes with it.
const MAX_DECIMAL_LENGTH = 32;

function requireNumber(text: string | undefined, field: string): number {
  if (text === undefined) throw new FacturXDeserializeError(`Missing numeric value: ${field}`);
  const value = decimalValue(text);
  if (value === undefined) throw new FacturXDeserializeError(`Invalid numeric value for ${field}: "${text}"`);
  return value;
}

function requireAmount(node: AmountNode, field: string): number {
  return requireNumber(textOf(node), field);
}

// Absent is undefined; present but not a decimal is an error, never a silent
// undefined — an unreadable prepaid amount is not the same as no prepayment.
function parseOptionalAmount(node: AmountNode, field: string): number | undefined {
  const text = textOf(node);
  return text === undefined ? undefined : requireNumber(text, field);
}

function decimalValue(text: string): number | undefined {
  if (text.length > MAX_DECIMAL_LENGTH || !DECIMAL.test(text)) return undefined;
  return Number(text);
}

function requireDate(node: ParsedDateTime | undefined, field: string): Date {
  const text = textOf(node?.DateTimeString);
  if (text === undefined) throw new FacturXDeserializeError(`Missing or invalid date: ${field}`);
  return parseDate102(text);
}

// Format 102 is exactly eight digits. Checked by round-tripping through the
// Date, because Date.UTC silently rolls "20260230" over to March 2nd.
function parseDate102(text: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [NaN, NaN, NaN];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new FacturXDeserializeError(`Invalid date (expected YYYYMMDD): "${text}"`);
  }
  return date;
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
