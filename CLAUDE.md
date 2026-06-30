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
  │                          backendId = "tier1-text"
  │
  └─ Scanned PDF / image / no text layer?
       └─ Tier 2 (AI): pdfRenderer.ts (rasterise) → selected backend worker → ExtractionResult

ExtractionResult → validator.ts → ValidationResult
                                       └─ flaggedFields → FieldEditor (HITL review)
```

**Tier 1** (`src/lib/textParser.ts`) — regex extraction for structured PDFs. Handles Norwegian number format (`23.002,32` = dot thousands, comma decimal). Extraction order matters: buyer is extracted before seller so the seller scan can skip the buyer's name. Math consistency check is skipped when any `lineExtensionAmount < 0` (credit card statements include payment credits in line items).

**Tier 2** — runs whichever backend the user has selected (see below). The backend is a Web Worker that speaks a shared postMessage protocol and always returns `ExtractionResult`.

**The Tier 1 path is an optimisation for text-layer PDFs, not the general solution.** Tier 2 is the general path and handles any invoice type.

---

### Pluggable backend system (`src/backends/`)

Tier 2 uses a registry of interchangeable extraction backends. The user selects one in the UI; the selection persists to `localStorage`. Switching backends terminates the old worker and starts the new one.

#### Adding a new backend — three steps only

1. Create `src/backends/{name}.worker.ts` — implement the shared protocol:
   - Listen for `{ type: "load" }` → post `progress` events → post `{ type: "ready" }`
   - Listen for `{ type: "infer", imageUrl }` → post `{ type: "result", payload: ExtractionResult }` or `{ type: "error", message }`
2. Add an entry to `BACKEND_REGISTRY` in `src/backends/registry.ts` with `meta` and `createWorker`.
3. That's it — the `BackendSelector` UI and `useInvoiceWorker` hook pick it up automatically.

#### Current backends

| ID | Name | Size | Strategy |
|---|---|---|---|
| `smolvlm` | SmolVLM-500M | ~300 MB | Single-stage VLM, prompted for JSON. Prone to hallucination on dense tables. |
| `florence2` | Florence-2 + Parser | ~249 MB | Florence-2 `<OCR>` task extracts text → deterministic regex parser handles fields. No hallucination on numbers. |

**Planned next backend:** Two-stage PaddleOCR (PP-OCRv6, ~15 MB) + Qwen2.5-0.5B-Instruct (4-bit, ~350 MB) with `transformers-llguidance` for guaranteed valid JSON schema output. Recommended by Gemini Deep Research as the most reliable architecture for financial documents.

#### Key files

```
src/backends/
  types.ts              — BackendMeta, WorkerInMessage, WorkerOutMessage types
  registry.ts           — BACKEND_REGISTRY, BackendId, getBackend(), DEFAULT_BACKEND_ID
  smolvlm.worker.ts     — SmolVLM-500M-Instruct backend
  florence2.worker.ts   — Florence-2-base-ft OCR backend
```

---

### Schema and validation (`src/lib/schema.ts`, `src/lib/validator.ts`)

`src/types/invoice.ts` defines the `Invoice` interface as a simplified subset of **Peppol BIS Billing 3.0** (EN 16931). All extraction output maps to this type.

`REQUIRED_FIELDS`: `invoiceNumber`, `issueDate`, `typeCode`, `currencyCode`, `buyer`, `seller`, `totals` — missing any of these blocks `ValidationResult.valid`.

`RECOMMENDED_FIELDS`: `lineItems` — missing is a `low_confidence` warning, not a hard error (credit card statements and receipts legitimately omit line items).

`CONFIDENCE_THRESHOLD = 0.85` — fields below this are added to `ValidationResult.flaggedFields` and surfaced in `FieldEditor` for human correction. `valid` is only blocked by `math_mismatch`, `missing_required`, and `invalid_format` issues; `low_confidence` warnings do not block it.

`ExtractionResult` carries two optional debug fields: `backendId` (which backend produced this result) and `extractionMs` (wall-clock inference time).

### HITL flow (`src/components/FieldEditor.tsx`)

`FieldEditor` receives `flaggedFields` from `ValidationResult`. Each field has a controlled input and an explicit **Confirm** button (Enter also confirms). Confirming calls `handleCorrect` in `App.tsx`, which:
1. Writes the corrected value into the invoice via `applyNestedUpdate` (dot-notation path)
2. Deletes the confidence entry for that field
3. Re-runs `validateInvoice`

Confirmed fields stay visible in the panel (green state) so the user can see what was saved — they are not removed from the rendered list even though they drop out of `flaggedFields`.

### Debug panel (`src/components/DebugPanel.tsx`)

Collapsible panel rendered below the extracted data. Shows:
- Backend name and pipeline stages
- Extraction time
- Per-field confidence bars (green ≥ 85%, yellow < 85%)
- Raw model output (truncated, with expand button)

### Key architectural constraints

**COOP/COEP headers are mandatory.** `SharedArrayBuffer` (required by ONNX Runtime WASM) is only available when the page is cross-origin isolated. `vite.config.ts` sets these on the dev server; the production host must do the same.

**Workers must be ES module format.** `vite.config.ts` sets `worker.format: "es"`. All backend workers are instantiated with `{ type: "module" }`.

**`pdfjs-dist` and `@huggingface/transformers` are excluded from Vite's dep optimiser** (`optimizeDeps.exclude`) — both ship their own worker/WASM bundles that conflict with Vite's pre-bundling.

**PDF.js worker is loaded from CDN** (`unpkg`) to avoid bundling the ~300 KB worker script.

**Florence-2 imports `textParser` dynamically inside the worker** — Vite code-splits this into a separate chunk automatically, keeping the main bundle clean.
