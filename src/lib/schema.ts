import type { Invoice, LineItem, Party } from "../types/invoice";

/** Human-readable label for each dot-notation path used in validation/HITL UI */
export const FIELD_LABELS: Record<string, string> = {
  invoiceNumber: "Invoice Number",
  issueDate: "Issue Date",
  dueDate: "Due Date",
  typeCode: "Invoice Type Code",
  currencyCode: "Currency Code",
  "seller.name": "Seller Name",
  "seller.vatId": "Seller VAT ID",
  "seller.address.countryCode": "Seller Country",
  "buyer.name": "Buyer Name",
  "buyer.address.countryCode": "Buyer Country",
  "totals.taxExclusiveAmount": "Net Amount (excl. tax)",
  "totals.taxInclusiveAmount": "Gross Amount (incl. tax)",
  "totals.payableAmount": "Payable Amount",
};

/** Fields that must be present for a valid Peppol BIS 3.0 invoice */
export const REQUIRED_FIELDS: (keyof Invoice)[] = [
  "invoiceNumber",
  "issueDate",
  "typeCode",
  "currencyCode",
  "buyer",
  "seller",
  "totals",
];

/**
 * lineItems are required for a strict Peppol invoice but many document types
 * (credit card statements, receipts) don't have them. We track them separately
 * so the PoC can handle both — a missing lineItems array is a warning, not a blocker.
 */
export const RECOMMENDED_FIELDS: (keyof Invoice)[] = ["lineItems"];

/** Threshold below which a field is highlighted for human review */
export const CONFIDENCE_THRESHOLD = 0.85;

/** Blank invoice used as the default extraction target */
export function emptyInvoice(): Invoice {
  return {
    invoiceNumber: "",
    issueDate: "",
    typeCode: "380",
    currencyCode: "EUR",
    buyer: emptyParty(),
    seller: emptyParty(),
    lineItems: [],
    taxSubtotals: [],
    totals: {
      taxExclusiveAmount: 0,
      taxInclusiveAmount: 0,
      payableAmount: 0,
    },
  };
}

function emptyParty(): Party {
  return { name: "", address: { countryCode: "" } };
}

/** Construct a blank line item */
export function emptyLineItem(id: string): LineItem {
  return {
    id,
    name: "",
    quantity: 1,
    unitCode: "EA",
    unitPrice: 0,
    lineExtensionAmount: 0,
    vatRatePercent: 0,
  };
}

/** Valid UNTDID 1001 invoice type codes */
export const VALID_TYPE_CODES = new Set(["380", "381", "326"]);

/** ISO 4217 currency code pattern */
export const CURRENCY_RE = /^[A-Z]{3}$/;

/** ISO 8601 date pattern */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO 3166-1 alpha-2 country code pattern */
export const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
