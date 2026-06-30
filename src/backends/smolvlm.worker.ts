import { AutoProcessor, AutoModelForVision2Seq, RawImage } from "@huggingface/transformers";
import type { ExtractionResult, Invoice, ConfidenceMap } from "../types/invoice";
import { emptyInvoice, DATE_RE } from "../lib/schema";

// Swap to "HuggingFaceTB/SmolVLM-500M-Instruct" for better accuracy at ~2× the download size.
const MODEL_ID = "HuggingFaceTB/SmolVLM-500M-Instruct";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null;

const EXTRACTION_PROMPT = `Extract invoice data from the image and return a JSON object in this exact structure. Use the example below as the format — replace every value with what you actually see in the image.

Example output (with fake data — replace with real values):
{"invoiceNumber":"INV-2024-001","issueDate":"2024-06-01","dueDate":"2024-07-01","typeCode":"380","currencyCode":"NOK","seller":{"name":"Firma AS","vatId":"NO123456789MVA","address":{"street":"Storgata 1","city":"Oslo","postCode":"0101","countryCode":"NO"}},"buyer":{"name":"Ola Nordmann","vatId":null,"address":{"street":"Veien 5","city":"Bergen","postCode":"5003","countryCode":"NO"}},"lineItems":[],"taxSubtotals":[],"totals":{"taxExclusiveAmount":1000.00,"taxInclusiveAmount":1250.00,"payableAmount":1250.00}}

Rules:
- issueDate = invoice/statement date in YYYY-MM-DD format
- dueDate = payment due date in YYYY-MM-DD format, or null
- currencyCode = exactly 3 letters (NOK, EUR, USD, etc.)
- payableAmount = the total amount due as a plain number
- Use null for any field you cannot find in the document
- Output only the JSON, no explanation`;

self.addEventListener("message", async (event: MessageEvent) => {
  const { type, imageUrl } = event.data as { type: string; imageUrl?: string };
  if (type === "load") await loadModel();
  else if (type === "infer" && imageUrl) await runInference(imageUrl);
});

function postProgress(progress: number, message: string) {
  self.postMessage({ type: "progress", progress, message });
}

async function loadModel() {
  try {
    const device = await detectDevice();
    const dtype = device === "webgpu" ? "fp16" : "q8";

    // Track per-file byte progress so the overall bar never jumps backward
    const procBytes = new Map<string, { loaded: number; total: number }>();
    const modelBytes = new Map<string, { loaded: number; total: number }>();
    let maxPct = 0;

    function byteProgress(map: Map<string, { loaded: number; total: number }>): number {
      let loaded = 0; let total = 0;
      for (const f of map.values()) { loaded += f.loaded; total += f.total; }
      return total > 0 ? loaded / total : 0;
    }

    function reportProgress(map: Map<string, { loaded: number; total: number }>, rangeStart: number, rangeEnd: number, file: string) {
      const raw = rangeStart + byteProgress(map) * (rangeEnd - rangeStart);
      maxPct = Math.max(maxPct, raw);
      postProgress(maxPct, file ? `Downloading ${file}…` : "Loading…");
    }

    function makeCallback(map: Map<string, { loaded: number; total: number }>, rangeStart: number, rangeEnd: number) {
      return (info: ProgressInfo) => {
        const key = info.file ?? info.name ?? "file";
        if (info.status === "initiate") {
          map.set(key, { loaded: 0, total: (info as unknown as { total?: number }).total ?? 0 });
        } else if (info.status === "progress") {
          const p = info as unknown as { loaded?: number; total?: number };
          if (p.total) map.set(key, { loaded: p.loaded ?? 0, total: p.total });
        } else if (info.status === "done") {
          const existing = map.get(key);
          if (existing) map.set(key, { loaded: existing.total, total: existing.total });
        }
        reportProgress(map, rangeStart, rangeEnd, info.file ?? "");
      };
    }

    postProgress(0, "Loading processor…");
    processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: makeCallback(procBytes, 0, 10),
    });

    postProgress(10, "Loading model weights…");
    model = await AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
      device,
      dtype,
      progress_callback: makeCallback(modelBytes, 10, 100),
    });

    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
  }
}

async function runInference(imageUrl: string) {
  if (!processor || !model) {
    self.postMessage({ type: "error", message: "Model not loaded" });
    return;
  }

  try {
    const startMs = Date.now();
    const image = await RawImage.fromURL(imageUrl);

    const messages = [
      {
        role: "user",
        content: [
          { type: "image" },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ];

    // Apply the model's chat template to format the prompt
    const applyTemplate = processor.apply_chat_template?.bind(processor)
      ?? processor.tokenizer?.apply_chat_template?.bind(processor.tokenizer);

    const text = applyTemplate(messages, {
      add_generation_prompt: true,
      tokenize: false,
    });

    const inputs = await processor(text, image, { return_tensors: "pt" });

    const outputIds = await model.generate({
      ...inputs,
      max_new_tokens: 600,
      do_sample: false,
      repetition_penalty: 1.3,
    });

    // Decode only the newly generated tokens (skip the input prompt)
    const inputLen = inputs.input_ids.dims[1];
    const newTokenIds = outputIds.slice(null, [inputLen, null]);
    const decoded: string[] = processor.batch_decode
      ? processor.batch_decode(newTokenIds, { skip_special_tokens: true })
      : processor.tokenizer.batch_decode(newTokenIds, { skip_special_tokens: true });

    const raw = decoded[0] ?? "";
    console.log("[smolvlm worker] raw model output:", raw);
    const { invoice, confidence } = parseModelOutput(raw);
    const result: ExtractionResult = {
      invoice,
      confidence,
      rawOutput: raw,
      backendId: "smolvlm",
      extractionMs: Date.now() - startMs,
    };
    self.postMessage({ type: "result", payload: result });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
  }
}

async function detectDevice(): Promise<"webgpu" | "wasm"> {
  try {
    if ("gpu" in navigator) {
      const adapter = await (
        navigator as { gpu: { requestAdapter(): Promise<unknown> } }
      ).gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch {
    // ignore
  }
  return "wasm";
}

function extractJsonString(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function normalizeModelJson(obj: Record<string, unknown>): Record<string, unknown> {
  const keyAliases: Record<string, string> = {
    issuedDate: "issueDate", invoiceDate: "issueDate", statementDate: "issueDate",
    expiredDate: "dueDate", paymentDueDate: "dueDate", payDueDate: "dueDate",
    creditCardType: "typeCode", invoiceType: "typeCode",
    creditCardVATID: "currencyCode",
    sellerName: "seller", vendorName: "seller",
    buyerName: "buyer", customerName: "buyer",
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[keyAliases[k] ?? k] = v;
  }
  // Hoist flat name fields into nested objects if needed
  if (typeof out["seller"] === "string") out["seller"] = { name: out["seller"] };
  if (typeof out["buyer"] === "string") out["buyer"] = { name: out["buyer"] };
  return out;
}

function parseModelOutput(raw: string): { invoice: Invoice; confidence: ConfidenceMap } {
  const base = emptyInvoice();
  const confidence: ConfidenceMap = {};

  let parsed: Partial<Invoice> = {};
  try {
    const jsonObj = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
    parsed = normalizeModelJson(jsonObj) as Partial<Invoice>;
  } catch {
    const fields = [
      "invoiceNumber", "issueDate", "currencyCode",
      "seller.name", "buyer.name", "totals.payableAmount",
    ];
    for (const f of fields) confidence[f] = 0.3;
    return { invoice: base, confidence };
  }

  const invoice: Invoice = {
    invoiceNumber: str(parsed.invoiceNumber),
    issueDate: str(parsed.issueDate),
    dueDate: str(parsed.dueDate) || undefined,
    typeCode: (["380", "381", "326"].includes(String(parsed.typeCode))
      ? parsed.typeCode
      : "380") as Invoice["typeCode"],
    currencyCode: str(parsed.currencyCode).toUpperCase() || "EUR",
    seller: mergeParty(base.seller, parsed.seller),
    buyer: mergeParty(base.buyer, parsed.buyer),
    lineItems: Array.isArray(parsed.lineItems)
      ? parsed.lineItems.map((li, i) => ({
          id: str(li.id) || String(i + 1),
          name: str(li.name),
          quantity: num(li.quantity, 1),
          unitCode: str(li.unitCode) || "EA",
          unitPrice: num(li.unitPrice),
          lineExtensionAmount: num(li.lineExtensionAmount),
          vatRatePercent: num(li.vatRatePercent),
        }))
      : [],
    taxSubtotals: Array.isArray(parsed.taxSubtotals)
      ? parsed.taxSubtotals.map((t) => ({
          taxableAmount: num(t.taxableAmount),
          taxAmount: num(t.taxAmount),
          categoryCode: (t.categoryCode ?? "S") as Invoice["taxSubtotals"][0]["categoryCode"],
          ratePercent: num(t.ratePercent),
        }))
      : [],
    totals: {
      taxExclusiveAmount: num(parsed.totals?.taxExclusiveAmount),
      taxInclusiveAmount: num(parsed.totals?.taxInclusiveAmount),
      payableAmount: num(parsed.totals?.payableAmount),
    },
    notes: str(parsed.notes) || undefined,
  };

  // Attempt to normalise common non-ISO date formats to YYYY-MM-DD
  invoice.issueDate = normDate(invoice.issueDate);
  if (invoice.dueDate) invoice.dueDate = normDate(invoice.dueDate);

  if (!invoice.invoiceNumber) confidence["invoiceNumber"] = 0.5;
  if (!invoice.issueDate || !DATE_RE.test(invoice.issueDate)) confidence["issueDate"] = 0.6;
  if (!invoice.seller.name) confidence["seller.name"] = 0.5;
  if (!invoice.buyer.name) confidence["buyer.name"] = 0.5;
  if (!invoice.totals.payableAmount) confidence["totals.payableAmount"] = 0.6;

  return { invoice, confidence };
}

function str(v: unknown): string {
  if (v == null || v === "null" || v === "undefined") return "";
  return String(v).trim();
}

function normDate(v: string | undefined): string {
  if (!v) return "";
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // DD-MM-YYYY or DD.MM.YYYY
  const dmy = v.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  // MM/DD/YYYY
  const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return v;
}

function num(v: unknown, fallback = 0): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

function mergeParty(
  base: Invoice["seller"],
  partial?: Partial<Invoice["seller"]>
): Invoice["seller"] {
  if (!partial) return base;
  return {
    name: str(partial.name),
    vatId: str(partial.vatId) || undefined,
    electronicAddress: str(partial.electronicAddress) || undefined,
    address: {
      street: str(partial.address?.street) || undefined,
      city: str(partial.address?.city) || undefined,
      postCode: str(partial.address?.postCode) || undefined,
      countryCode: str(partial.address?.countryCode).toUpperCase() || undefined,
    },
  };
}

interface ProgressInfo {
  status: string;
  name?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}
