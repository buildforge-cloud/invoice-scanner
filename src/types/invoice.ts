/**
 * Simplified Peppol BIS Billing 3.0 schema for the PoC.
 * Covers the five mandatory semantic groups from EN 16931.
 */

export type InvoiceTypeCode =
  | "380" // Commercial Invoice
  | "381" // Credit Note
  | "326"; // Partial Invoice

export type VatCategoryCode =
  | "S" // Standard rate
  | "Z" // Zero rated
  | "E" // Exempt
  | "AE" // Reverse charge
  | "K" // Intra-community supply
  | "G" // Export
  | "O"; // Outside scope

export interface Party {
  name: string;
  vatId?: string;
  address?: {
    street?: string;
    city?: string;
    postCode?: string;
    countryCode?: string; // ISO 3166-1 alpha-2
  };
  electronicAddress?: string;
}

export interface TaxSubtotal {
  taxableAmount: number;
  taxAmount: number;
  categoryCode: VatCategoryCode;
  ratePercent: number;
  exemptionReason?: string;
}

export interface LineItem {
  id: string;
  name: string;
  quantity: number;
  unitCode: string; // UN/ECE Rec20
  unitPrice: number;
  lineExtensionAmount: number; // quantity * unitPrice, 2dp
  vatRatePercent: number;
}

export interface MonetaryTotals {
  taxExclusiveAmount: number;
  taxInclusiveAmount: number;
  payableAmount: number;
  prepaidAmount?: number;
  roundingAmount?: number;
}

/** Top-level invoice object matching Peppol BIS Billing 3.0 mandatory fields */
export interface Invoice {
  invoiceNumber: string;
  issueDate: string; // ISO 8601 YYYY-MM-DD
  dueDate?: string;
  typeCode: InvoiceTypeCode;
  currencyCode: string; // ISO 4217
  buyer: Party;
  seller: Party;
  lineItems: LineItem[];
  taxSubtotals: TaxSubtotal[];
  totals: MonetaryTotals;
  notes?: string;
}

/** Per-field confidence score emitted alongside the extracted invoice */
export type ConfidenceMap = Record<string, number>;

/** Result returned by the inference worker */
export interface ExtractionResult {
  invoice: Invoice;
  confidence: ConfidenceMap;
  rawOutput: string;
}

/** A single field flagged for human review */
export interface FlaggedField {
  path: string; // dot-notation key, e.g. "totals.payableAmount"
  label: string;
  extractedValue: string;
  confidence: number;
}

export type ValidationIssue =
  | { kind: "math_mismatch"; message: string }
  | { kind: "missing_required"; field: string }
  | { kind: "invalid_format"; field: string; message: string }
  | { kind: "low_confidence"; field: string; score: number };

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  flaggedFields: FlaggedField[];
}
