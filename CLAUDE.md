# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # first-time setup
npm run dev          # dev server — see proxy note below
npm run build        # tsc type-check + vite production build
npm run preview      # serve the production build locally
```

No test runner is configured (PoC stage).

**Dev proxy:** The dev server is accessed via `dev.buildforge.cloud/proxy/5173`. `vite.config.ts` sets `base: "/proxy/5173/"` and includes a middleware that rewrites incoming URLs to include the prefix. HMR is disabled (WebSocket can't route through path-based proxies) — reload manually after changes.

## Architecture

Fully serverless, in-browser invoice scanner. No API calls, no backend. All processing runs on the user's device.

### Two-tier extraction pipeline

```
File upload (PDF / image)
  │
  ├─ PDF with text layer?
  │    └─ Tier 1 (instant): pdfTextExtractor.ts → textParser.ts → ExtractionResult
  │
  └─ Scanned PDF / image / no text layer?
       └─ Tier 2 (AI): pdfRenderer.ts (rasterise) → inference.worker.ts → ExtractionResult
            └─ SmolVLM-500M-Instruct via Transformers.js (WebGPU / WASM fallback)

ExtractionResult → validator.ts → ValidationResult
                                       └─ flaggedFields → FieldEditor (HITL review)
```

**Tier 1** (`src/lib/textParser.ts`) — regex extraction for structured PDFs. Handles Norwegian number format (`23.002,32` = dot thousands, comma decimal). Extraction order matters: buyer is extracted before seller so the seller scan can skip the buyer's name. Math consistency check is skipped when any `lineExtensionAmount < 0` (credit card statements include payment credits in line items).

**Tier 2** (`src/workers/inference.worker.ts`) — Transformers.js loads `HuggingFaceTB/SmolVLM-500M-Instruct`. Device detection tries WebGPU (`fp16`) and falls back to WASM (`q8`). Model weights (~300 MB) are downloaded once and cached in IndexedDB by Transformers.js. Progress is tracked byte-by-byte across processor (0–10%) and model weights (10–100%) so the bar never jumps backward.

**The Tier 1 path is an optimisation for text-layer PDFs, not the general solution.** Tier 2 (VLM) is the general path and handles any invoice type.

### Key constraints

**COOP/COEP headers are mandatory.** `SharedArrayBuffer` (required by ONNX Runtime WASM) is only available when the page is cross-origin isolated. `vite.config.ts` sets these on the dev server; the production host must do the same.

**Workers must be ES module format.** `vite.config.ts` sets `worker.format: "es"`. The worker is instantiated with `{ type: "module" }` in `useInvoiceWorker.ts`.

**`pdfjs-dist` and `@huggingface/transformers` are excluded from Vite's dep optimiser** (`optimizeDeps.exclude`) — both ship their own worker/WASM bundles that conflict with Vite's pre-bundling.

**PDF.js worker is loaded from CDN** (`unpkg`) to avoid bundling the ~300 KB worker script.

### Schema and validation (`src/lib/schema.ts`, `src/lib/validator.ts`)

`src/types/invoice.ts` defines the `Invoice` interface as a simplified subset of **Peppol BIS Billing 3.0** (EN 16931). All extraction output maps to this type.

`REQUIRED_FIELDS`: `invoiceNumber`, `issueDate`, `typeCode`, `currencyCode`, `buyer`, `seller`, `totals` — missing any of these blocks `ValidationResult.valid`.

`RECOMMENDED_FIELDS`: `lineItems` — missing is a `low_confidence` warning, not a hard error (credit card statements and receipts legitimately omit line items).

`CONFIDENCE_THRESHOLD = 0.85` — fields below this are added to `ValidationResult.flaggedFields` and surfaced in `FieldEditor` for human correction. `valid` is only blocked by `math_mismatch`, `missing_required`, and `invalid_format` issues; `low_confidence` warnings do not block it.

### HITL flow (`src/components/FieldEditor.tsx`)

`FieldEditor` receives `flaggedFields` from `ValidationResult`. Each field has a controlled input and an explicit **Confirm** button (Enter also confirms). Confirming calls `handleCorrect` in `App.tsx`, which:
1. Writes the corrected value into the invoice via `applyNestedUpdate` (dot-notation path)
2. Deletes the confidence entry for that field
3. Re-runs `validateInvoice`

Confirmed fields stay visible in the panel (green state) so the user can see what was saved — they are not removed from the rendered list even though they drop out of `flaggedFields`.
