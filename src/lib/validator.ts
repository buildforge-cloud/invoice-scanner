import type {
  Invoice,
  ConfidenceMap,
  ValidationResult,
  ValidationIssue,
  FlaggedField,
} from "../types/invoice";
import {
  REQUIRED_FIELDS,
  RECOMMENDED_FIELDS,
  CONFIDENCE_THRESHOLD,
  FIELD_LABELS,
  VALID_TYPE_CODES,
  CURRENCY_RE,
  DATE_RE,
  COUNTRY_CODE_RE,
} from "./schema";

/** Round to 2 decimal places using banker's rounding to avoid float drift */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function validateInvoice(
  invoice: Invoice,
  confidence: ConfidenceMap
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const flaggedFields: FlaggedField[] = [];

  // 1. Required fields presence
  function isMissing(val: unknown) {
    return val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
  }
  for (const field of REQUIRED_FIELDS) {
    if (isMissing(invoice[field])) issues.push({ kind: "missing_required", field });
  }
  // Recommended fields (e.g. lineItems) are logged as low_confidence warnings, not hard errors
  for (const field of RECOMMENDED_FIELDS) {
    if (isMissing(invoice[field])) {
      issues.push({ kind: "low_confidence", field, score: 0 });
    }
  }

  // 2. Format checks
  if (invoice.typeCode && !VALID_TYPE_CODES.has(invoice.typeCode)) {
    issues.push({
      kind: "invalid_format",
      field: "typeCode",
      message: `"${invoice.typeCode}" is not a valid UNTDID 1001 code`,
    });
  }

  if (invoice.currencyCode && !CURRENCY_RE.test(invoice.currencyCode)) {
    issues.push({
      kind: "invalid_format",
      field: "currencyCode",
      message: "Must be an ISO 4217 3-letter code (e.g. EUR, USD)",
    });
  }

  if (invoice.issueDate && !DATE_RE.test(invoice.issueDate)) {
    issues.push({
      kind: "invalid_format",
      field: "issueDate",
      message: "Must be YYYY-MM-DD",
    });
  }

  if (invoice.dueDate && !DATE_RE.test(invoice.dueDate)) {
    issues.push({
      kind: "invalid_format",
      field: "dueDate",
      message: "Must be YYYY-MM-DD",
    });
  }

  for (const party of ["seller", "buyer"] as const) {
    const cc = invoice[party]?.address?.countryCode;
    if (cc && !COUNTRY_CODE_RE.test(cc)) {
      issues.push({
        kind: "invalid_format",
        field: `${party}.address.countryCode`,
        message: "Must be ISO 3166-1 alpha-2 (e.g. DE, NO)",
      });
    }
  }

  // 3. Math consistency: sum of line extensions + tax = payable amount
  // Skip for account/credit-card statements where line items include payments (negative amounts)
  const hasCredits = invoice.lineItems.some((li) => li.lineExtensionAmount < 0);
  if (invoice.lineItems.length > 0 && !hasCredits) {
    const lineSum = round2(
      invoice.lineItems.reduce((acc, li) => acc + li.lineExtensionAmount, 0)
    );
    const taxTotal = round2(
      invoice.taxSubtotals.reduce((acc, t) => acc + t.taxAmount, 0)
    );
    const expectedPayable = round2(lineSum + taxTotal);
    const extractedPayable = round2(invoice.totals.payableAmount);

    if (Math.abs(expectedPayable - extractedPayable) > 0.02) {
      issues.push({
        kind: "math_mismatch",
        message: `Line items (${lineSum}) + tax (${taxTotal}) = ${expectedPayable}, but payable amount is ${extractedPayable}`,
      });
    }

    // Also check line extension amounts match quantity * unit price
    for (const li of invoice.lineItems) {
      const expected = round2(li.quantity * li.unitPrice);
      if (Math.abs(expected - round2(li.lineExtensionAmount)) > 0.02) {
        issues.push({
          kind: "math_mismatch",
          message: `Line "${li.name}": ${li.quantity} × ${li.unitPrice} = ${expected}, but lineExtensionAmount is ${li.lineExtensionAmount}`,
        });
      }
    }
  }

  // 4. Low-confidence fields → HITL flagging
  for (const [path, score] of Object.entries(confidence)) {
    if (score < CONFIDENCE_THRESHOLD) {
      flaggedFields.push({
        path,
        label: FIELD_LABELS[path] ?? path,
        extractedValue: resolveNestedPath(invoice, path),
        confidence: score,
      });
      issues.push({ kind: "low_confidence", field: path, score });
    }
  }

  return {
    valid: issues.filter((i) => i.kind !== "low_confidence").length === 0,
    issues,
    flaggedFields,
  };
}

function resolveNestedPath(obj: unknown, path: string): string {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur == null ? "" : String(cur);
}
