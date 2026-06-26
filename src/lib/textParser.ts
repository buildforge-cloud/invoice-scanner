import type { ExtractionResult, Invoice, ConfidenceMap } from "../types/invoice";
import { emptyInvoice } from "./schema";

export function parseInvoiceFromText(
  lines: string[],
  fullText: string
): ExtractionResult {
  const invoice = emptyInvoice();
  const confidence: ConfidenceMap = {};

  extractCurrency(fullText, invoice, confidence);
  extractDates(fullText, invoice, confidence);
  extractInvoiceNumber(fullText, invoice, confidence);
  extractAmounts(fullText, invoice, confidence);
  extractBuyer(fullText, lines, invoice, confidence);   // buyer first so seller can skip it
  extractSeller(fullText, lines, invoice, confidence);
  extractTypeCode(fullText, invoice, confidence);
  extractLineItems(lines, invoice, confidence);

  return {
    invoice,
    confidence,
    rawOutput: fullText,
  };
}

// ── Currency ─────────────────────────────────────────────────────────────────

function extractCurrency(text: string, inv: Invoice, conf: ConfidenceMap) {
  // "kr" is an unambiguous NOK marker; check it before scanning for currency codes so that
  // foreign currency codes inside individual transaction descriptions (e.g. "USD 4.41") do not
  // override the document-level currency.
  if (/\bkr\.?\b/i.test(text)) {
    inv.currencyCode = "NOK";
    conf["currencyCode"] = 0.92;
    return;
  }
  // Prefer a currency code found in the header area (first 40 lines) over one buried in
  // transaction descriptions where foreign currencies often appear.
  const headerText = text.split("\n").slice(0, 40).join("\n");
  const inHeader = headerText.match(/\b(NOK|EUR|USD|GBP|SEK|DKK|CHF|JPY)\b/);
  if (inHeader) {
    inv.currencyCode = inHeader[1];
    conf["currencyCode"] = 0.9;
    return;
  }
  // Fall back to first match anywhere (lower confidence — may be a foreign tx description)
  const anywhere = text.match(/\b(NOK|EUR|USD|GBP|SEK|DKK|CHF|JPY)\b/);
  if (anywhere) {
    inv.currencyCode = anywhere[1];
    conf["currencyCode"] = 0.72;
  }
}

// ── Dates ─────────────────────────────────────────────────────────────────────

const DATE_RE = /(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})/;

function parseDate(s: string): string | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const dmy = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function extractDates(text: string, inv: Invoice, conf: ConfidenceMap) {
  const issuePat = /(?:fakturadato|fakturadatum|invoice\s*date|statement\s*date|billing\s*date|date\s*of\s*issue|issued?)[:\s]+(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i;
  const duePat = /(?:forfallsdato|förfallodatum|due\s*date|payment\s*due|pay(?:ment)?\s*by|betalingsfrist|betales\s*senest)[:\s]+(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i;

  const im = text.match(issuePat);
  if (im) {
    const d = parseDate(im[1]);
    if (d) { inv.issueDate = d; conf["issueDate"] = 0.95; }
  }

  const dm = text.match(duePat);
  if (dm) {
    const d = parseDate(dm[1]);
    if (d) { inv.dueDate = d; conf["dueDate"] = 0.95; }
  }

  // Fallback: if we still don't have issueDate, grab the first plausible date
  if (!inv.issueDate) {
    const m = text.match(DATE_RE);
    if (m) {
      const d = parseDate(`${m[1]}.${m[2]}.${m[3]}`);
      if (d) { inv.issueDate = d; conf["issueDate"] = 0.6; }
    }
  }
}

// ── Invoice / reference number ────────────────────────────────────────────────

function extractInvoiceNumber(text: string, inv: Invoice, conf: ConfidenceMap) {
  // KID number (Norwegian payment reference, 7-25 digits)
  const kid = text.match(/KID[\s\-]*(?:nummer|nr)?[:\s\-]*(\d{7,25})/i);
  if (kid) { inv.invoiceNumber = kid[1]; conf["invoiceNumber"] = 0.92; return; }

  // Generic invoice number
  const generic = text.match(
    /(?:faktura\s*(?:nr|nummer|#)|invoice\s*(?:no\.?|number|#|nr))[:\s#]*([A-Z0-9][A-Z0-9\-\/]{1,24})/i
  );
  if (generic) { inv.invoiceNumber = generic[1]; conf["invoiceNumber"] = 0.85; return; }

  // Account / card number (bank statements: "Kontonummer 8385 67 37511")
  const acct = text.match(/(?:kontonummer|account\s*(?:no|number))[:\s]+([0-9][0-9\s]{5,22})/i);
  if (acct) { inv.invoiceNumber = acct[1].replace(/\s/g, ""); conf["invoiceNumber"] = 0.87; return; }

  // Order / reference number fallback
  const ref = text.match(/(?:ordre\s*(?:nr|nummer)|order\s*(?:no\.?|number))[:\s#]*([A-Z0-9\-]{3,24})/i);
  if (ref) { inv.invoiceNumber = ref[1]; conf["invoiceNumber"] = 0.7; }
}

// ── Monetary amounts ──────────────────────────────────────────────────────────

function parseAmount(raw: string): number {
  const s = raw.trim().replace(/\s/g, "");
  // Norwegian: 23.002,32
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", "."));
  // US: 23,002.32
  if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(s)) return parseFloat(s.replace(/,/g, ""));
  // Plain with comma decimal: 805,08
  if (/^\d+,\d{2}$/.test(s)) return parseFloat(s.replace(",", "."));
  return parseFloat(s) || 0;
}

function firstAmount(pattern: RegExp, text: string): number | null {
  const m = text.match(pattern);
  if (!m) return null;
  const raw = m[1].replace(/^-/, ""); // take absolute value — callers handle sign separately
  const v = parseAmount(raw);
  return v > 0 ? v : null;
}

function extractAmounts(text: string, inv: Invoice, conf: ConfidenceMap) {
  // Total payable — most specific labels first.
  // Use [^\n]{0,60} not [^0-9kr] so "per 01.06.2026" in the label doesn't block the match.
  // "Ny skyldig saldo" is the DNB format; amounts can be negative (liability) — abs value is payable.
  const payable =
    firstAmount(/totalt\s+skyldig\s+bel[øo]p\b[^\n]{0,60}kr\s*([\d.,]+)/i, text) ??
    firstAmount(/ny\s+skyldig\s+saldo[:\s]+(-?[\d.,]+)/i, text) ??
    firstAmount(/(?:total\s+amount\s+due|payable\s+amount|amount\s+due)[:\s]*(?:[A-Z]{3}\s*)?([\d.,]+)/i, text) ??
    firstAmount(/^totalt\s+skyldig[^\n]*kr\s*([\d.,]+)/im, text);

  if (payable != null) {
    inv.totals.payableAmount = payable;
    inv.totals.taxInclusiveAmount = payable;
    // Default: no tax breakdown found, so net = gross (tax displays as 0)
    if (inv.totals.taxExclusiveAmount === 0) inv.totals.taxExclusiveAmount = payable;
    conf["totals.payableAmount"] = 0.88;
  }

  // Net (excl. tax) if available
  const net =
    firstAmount(/(?:netto|net\s+amount|subtotal|excl\.?\s*(?:tax|vat|mva))[:\s]*(?:kr\s*)?([0-9][0-9\s.,]+)/i, text);
  if (net != null) {
    inv.totals.taxExclusiveAmount = net;
    conf["totals.taxExclusiveAmount"] = 0.8;
  }
}

// ── Seller ────────────────────────────────────────────────────────────────────

const COMPANY_SUFFIXES = /\b(?:AS|ASA|AB|Ltd\.?|LLC|Inc\.?|GmbH|SA|NV|BV|PLC)\b/;

function extractSeller(text: string, lines: string[], inv: Invoice, conf: ConfidenceMap) {
  // Explicit label — covers English and Norwegian (exclude bare "fra" — too common mid-sentence)
  const labeled = text.match(
    /(?:^|\n)(?:from|seller|vendor|billed?\s*by|issued?\s*by|leverand[øo]r)[:\s]+([^\n,]{3,60})/im
  );
  if (labeled) { inv.seller.name = labeled[1].trim(); conf["seller.name"] = 0.9; }

  if (!inv.seller.name) {
    // "Company Name, en filial av…" or "Company Name - Org nr." on the same line
    const sameLineOrg = text.match(/^([^\n,]{3,60}),[ \t]*(?:en\s+filial|a\s+branch|org\.?\s*nr\.?|vat\s*(?:no|nr|id))/im);
    if (sameLineOrg) { inv.seller.name = sameLineOrg[1].trim(); conf["seller.name"] = 0.88; }
  }

  if (!inv.seller.name) {
    // Scan the first 10 lines for the company heading — skip doc-type words, buyer name, address lines
    const skipWords = /^(?:faktura|invoice|receipt|tax\s+invoice|credit\s+note|kreditnota|kvittering)\s*$/i;
    const buyerName = inv.buyer.name?.toLowerCase() ?? "";
    for (const line of lines.slice(0, 10)) {
      const clean = line.replace(/[-–]\s*(?:kortet|kortt?|card|statement)\b.*/i, "").trim();
      if (
        !skipWords.test(clean) &&
        clean.length >= 3 &&
        clean.length <= 60 &&
        !/^\d/.test(clean) &&            // skip lines starting with digits (postcodes, dates)
        !/\s\d/.test(clean) &&           // skip address/date lines (e.g. "Vestaveien 45 C")
        (buyerName.length === 0 || clean.toLowerCase() !== buyerName)
      ) {
        inv.seller.name = clean;
        conf["seller.name"] = 0.72;
        break;
      }
    }
  }

  if (!inv.seller.name) {
    // First line anywhere with a recognised company suffix
    for (const line of lines.slice(0, 20)) {
      if (COMPANY_SUFFIXES.test(line) && line.length < 80) {
        inv.seller.name = line.trim();
        conf["seller.name"] = 0.68;
        break;
      }
    }
  }

  // VAT / org number — Norwegian (exactly 9 digits), EU format, or "VAT no: ..."
  // Require exactly 9 digits to avoid matching 10-digit transaction reference numbers
  const orgNr = text.match(/(?:org\.?\s*nr\.?|orgnr)[:\s.]*([0-9]{9})(?!\d)/i);
  if (orgNr) { inv.seller.vatId = orgNr[1]; conf["seller.vatId"] = 0.92; }
  else {
    // "mva" alone (e.g. "inkl. mva") is NOT a VAT-ID label — require explicit "vat no/nr/id"
    const vat = text.match(/(?:vat\s*(?:no|nr|id|number)|kvk|siren)[:\s#]*([A-Z]{0,2}[0-9]{6,12}(?:\s*MVA)?)/i);
    if (vat) { inv.seller.vatId = vat[1].replace(/\s/g, ""); conf["seller.vatId"] = 0.85; }
    else {
      const norvat = text.match(/\b([0-9]{9})\s*MVA\b/i);
      if (norvat) { inv.seller.vatId = norvat[1]; conf["seller.vatId"] = 0.88; }
    }
  }

  extractSellerAddress(text, inv, conf);
}

function extractSellerAddress(text: string, inv: Invoice, conf: ConfidenceMap) {
  inv.seller.address = inv.seller.address ?? {};

  // "Returadresse: Postboks 110, 1325 Lysaker, Norge"
  const retAddr = text.match(/returadresse[:\s]+([^\n]+)/i);
  if (retAddr) {
    const parts = retAddr[1].split(",").map((s) => s.trim());
    // parts[0] = "Postboks 110", parts[1] = "1325 Lysaker", parts[2] = "Norge"
    if (parts[0]) { inv.seller.address.street = parts[0]; conf["seller.address.street"] = 0.9; }
    if (parts[1]) {
      const pc = parts[1].match(/^(\d{4})\s+(.+)$/);
      if (pc) {
        inv.seller.address.postCode = pc[1];
        inv.seller.address.city = pc[2];
        conf["seller.address.city"] = 0.9;
      }
    }
    if (parts[2]) {
      const country = parts[2].toLowerCase();
      inv.seller.address.countryCode = country === "norge" || country === "norway" ? "NO" : parts[2].slice(0, 2).toUpperCase();
      conf["seller.address.countryCode"] = 0.88;
    }
    return;
  }

  // Fallback: postbox + nearest postcode/city
  const postBox = text.match(/(?:postboks|p\.?\s*o\.?\s*box)\s+(\d+)/i);
  if (postBox) { inv.seller.address.street = `Postboks ${postBox[1]}`; conf["seller.address.street"] = 0.8; }

  // Only run postcode scan when we already located a street — avoids matching "2026 Sum" in
  // two-column statement tables where "05.06.2026 Sum bruk..." lands on the same extracted line
  if (inv.seller.address.street) {
    const postCode = text.match(/\b(\d{4})[ \t]+([A-ZÆØÅ][a-zæøå]+(?:[ \t]+[A-ZÆØÅ][a-zæøå]+)*)\b/);
    if (postCode) {
      inv.seller.address.postCode = postCode[1];
      inv.seller.address.city = postCode[2];
      inv.seller.address.countryCode = "NO";
      conf["seller.address.city"] = 0.72;
    }
  }
}

// ── Buyer ─────────────────────────────────────────────────────────────────────

function extractBuyer(text: string, lines: string[], inv: Invoice, conf: ConfidenceMap) {
  // "Transaksjoner for Firstname Lastname" — common in Norwegian credit card statements.
  // Use [ \t]+ (not \s+) so we never cross a newline into the table header row.
  const transFor = text.match(/transaksjoner\s+for\s+((?:[A-ZÆØÅ][a-zæøå]+)(?:[ \t]+[A-ZÆØÅ][a-zæøå]+){1,2})/i);
  if (transFor) { inv.buyer.name = transFor[1].trim(); conf["buyer.name"] = 0.92; return; }

  // Explicit label — English and Norwegian; exclude bare "til"/"to" (too common mid-sentence)
  const labeled = text.match(
    /(?:^|\n)(?:bill(?:ed)?\s*to|sold\s*to|ship(?:ped)?\s*to|invoice\s*to|customer|client|kunde|faktureres\s*til|kjøper)[:\s]+([^\n,]{3,60})/im
  );
  if (labeled) { inv.buyer.name = labeled[1].trim(); conf["buyer.name"] = 0.88; return; }

  // Heuristic: Firstname [Initial.] Lastname line followed (within 2 lines) by a street address
  const streetRe = /\b(?:vei|veien|gate|gata|gaten|str[æe]?det?|pl[a.]?ss|alle[ée]?n?|rd|st|ave|blvd)\b/i;
  // Allow middle initials e.g. "Stefan M. Gulbrandsen"
  const nameRe = /^[A-ZÆØÅ][a-zæøå]+(?:[ \t]+[A-ZÆØÅ][A-Za-zæøåÆØÅ.]+){1,3}/;
  for (let i = 0; i < lines.length - 2; i++) {
    const line = lines[i].split(/\s{2,}/)[0]; // take only leftmost column if multi-column
    const next1 = lines[i + 1];
    const next2 = lines[i + 2];
    if (
      nameRe.test(line) &&
      !COMPANY_SUFFIXES.test(line) &&
      (streetRe.test(next1) || /^\d{4}\s/.test(next1) ||
       streetRe.test(next2) || /^\d{4}\s/.test(next2))
    ) {
      inv.buyer.name = line.trim();
      conf["buyer.name"] = 0.75;
      break;
    }
  }
}

// ── Type code ─────────────────────────────────────────────────────────────────

function extractTypeCode(text: string, inv: Invoice, conf: ConfidenceMap) {
  if (/\b(?:credit\s*note|kreditnota|kreditnote)\b/i.test(text)) {
    inv.typeCode = "381";
    conf["typeCode"] = 0.92;
  } else {
    conf["typeCode"] = 0.95;
  }
}

// ── Line items ────────────────────────────────────────────────────────────────

function extractLineItems(lines: string[], inv: Invoice, conf: ConfidenceMap) {
  // Strategy 1: Date-prefixed transaction table (credit card statements, expense reports)
  const txItems = extractDatePrefixedTable(lines);
  if (txItems.length > 0) {
    inv.lineItems = txItems;
    conf["lineItems"] = 0.88;
    return;
  }

  // Strategy 2: Description / Qty / Price / Total table (standard invoices)
  const stdItems = extractDescriptionTable(lines);
  if (stdItems.length > 0) {
    inv.lineItems = stdItems;
    conf["lineItems"] = 0.82;
  }
}

/**
 * Detects rows that start with a date (DD.MM.YYYY or YYYY-MM-DD) and end with
 * a monetary amount. Works for credit card statements, bank transactions, expense
 * reports — any document where each line is "date + description + amount".
 */
function extractDatePrefixedTable(lines: string[]): Invoice["lineItems"] {
  const DATE_PREFIX = /^(\d{2}[.\/\-]\d{2}[.\/\-]\d{4}|\d{4}-\d{2}-\d{2})\s+(.+)/;
  // Last amount on the line (Norwegian or US decimal, optionally negative)
  const LAST_AMOUNT = /(-?[\d.]+,\d{2}|-?[\d,]+\.\d{2})\s*$/;
  // Card/account number artefacts to strip from descriptions
  const CARD_NO = /\s+\d{4,6}\*+\d{4,}\b/g;

  const items: Invoice["lineItems"] = [];
  let matchCount = 0;

  for (const line of lines) {
    const dateM = line.match(DATE_PREFIX);
    if (!dateM) continue;

    const amtM = line.match(LAST_AMOUNT);
    if (!amtM) continue;

    const rawAmount = amtM[1];
    const amount = parseAmount(rawAmount.replace(/^-/, ""));
    if (amount === 0) continue;
    const signed = rawAmount.trim().startsWith("-") ? -amount : amount;

    // Clean up description — order matters:
    // 1. strip card number artefact (469279***1701)
    // 2. strip "LOCAL_AMOUNT CURRENCY [SIGNED_FINAL]" from the end (e.g. "46,00 NOK 46,00")
    // 3. strip any remaining trailing amount
    // 4. strip trailing 10-digit transaction reference numbers (DNB format: always 10 digits)
    //    Use exactly 10 so we don't strip 11-digit Norwegian account numbers (e.g. Innbetaling fra 12037550017)
    // 5. normalise spacing/punctuation
    let desc = dateM[2].replace(CARD_NO, "");
    desc = desc.replace(/\s+[\d.,]+\s+[A-Z]{3}(?:\s+[-]?[\d.,]+)?\s*$/, "");
    desc = desc.replace(LAST_AMOUNT, "");
    desc = desc.replace(/(\s+\d{10})+\s*$/, "");
    desc = desc.replace(/[\s,\-–]+$/, "").replace(/\s+,\s*/g, ", ").replace(/\s{2,}/g, " ").trim();

    if (desc.length < 2) continue;

    items.push({
      id: String(items.length + 1),
      name: desc,
      quantity: 1,
      unitCode: "EA",
      unitPrice: signed,
      lineExtensionAmount: signed,
      vatRatePercent: 0,
    });
    matchCount++;
  }

  // Only return if we found a meaningful cluster of date-amount rows (not stray dates)
  return matchCount >= 3 ? items : [];
}

/**
 * Detects a standard invoice line-item table: rows where the last column is a
 * monetary total and an earlier column is a unit price. Works across languages
 * because it relies on the numeric structure, not the header text.
 */
function extractDescriptionTable(lines: string[]): Invoice["lineItems"] {
  // Heuristic: find a header row with price/total keywords
  const HEADER_RE = /(?:description|qty|quantity|unit\s*price|amount|total|beløp|pris|antall)/i;
  const headerIdx = lines.findIndex((l) => HEADER_RE.test(l));
  if (headerIdx === -1) return [];

  const TWO_AMOUNTS = /([\d.,]+)\s+([\d.,]+)\s*$/; // "qty unitprice" OR "unitprice total"
  const ONE_AMOUNT = /([\d.,]+)\s*$/;

  const items: Invoice["lineItems"] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^[-=]{3,}/.test(line)) break; // table separator or end

    const twoM = line.match(TWO_AMOUNTS);
    if (twoM) {
      const unitPrice = parseAmount(twoM[1]);
      const total = parseAmount(twoM[2]);
      if (unitPrice === 0 && total === 0) continue;
      const desc = line.replace(TWO_AMOUNTS, "").trim();
      if (desc.length < 2) continue;
      items.push({
        id: String(items.length + 1),
        name: desc,
        quantity: 1,
        unitCode: "EA",
        unitPrice,
        lineExtensionAmount: total || unitPrice,
        vatRatePercent: 0,
      });
      continue;
    }

    const oneM = line.match(ONE_AMOUNT);
    if (oneM) {
      const total = parseAmount(oneM[1]);
      if (total === 0) continue;
      const desc = line.replace(ONE_AMOUNT, "").trim();
      if (desc.length < 2) continue;
      items.push({
        id: String(items.length + 1),
        name: desc,
        quantity: 1,
        unitCode: "EA",
        unitPrice: total,
        lineExtensionAmount: total,
        vatRatePercent: 0,
      });
    }
  }

  return items.length >= 1 ? items : [];
}
