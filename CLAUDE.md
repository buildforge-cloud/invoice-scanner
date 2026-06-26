# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # first-time setup
npm run dev          # dev server at http://localhost:5173
npm run build        # tsc type-check + vite production build
npm run preview      # serve the production build locally
```

No test runner is configured yet (PoC stage).

## Architecture

This is a **fully serverless, in-browser invoice scanner** — no API calls, no backend. Every byte of processing happens on the user's device using WebAssembly/WebGPU.

### Data flow

```
File upload (PDF/image)
  → pdfRenderer.ts   — PDF.js rasterizes each page to a canvas data URL
  → inference.worker.ts — Transformers.js runs a VLM (SmolVLM or Donut) entirely
                          in a Web Worker via WebGPU (fallback: WASM)
  → App.tsx          — receives ExtractionResult { invoice, confidence, rawOutput }
  → validator.ts     — deterministic checks wrap the probabilistic AI output
  → ResultPanel      — shows extracted data; FieldEditor surfaces low-confidence fields
                       for human correction (HITL)
```

### Key architectural constraints

**COOP/COEP headers are required.** `vite.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on the dev server. Without these, `SharedArrayBuffer` is unavailable and the ONNX Runtime WASM backend fails. The production host must also send these headers.

**Model weights are cached in IndexedDB.** On first load, Transformers.js downloads quantized ONNX weights (~100–300 MB) from the Hugging Face CDN. Subsequent visits are fully offline. The `useModel` hook tracks download progress via the library's `progress_callback`.

**Inference runs in a Web Worker.** The VLM blocks for several seconds; keeping it off the main thread prevents UI freezes. The worker file is `src/workers/inference.worker.ts` and is bundled as an ES module worker (`vite.config.ts → worker.format: "es"`).

**pdfjs-dist worker is loaded from CDN.** `pdfRenderer.ts` lazy-imports pdfjs and points `GlobalWorkerOptions.workerSrc` at unpkg to avoid bundling the ~300 KB worker script.

### Schema and validation

`src/types/invoice.ts` defines the `Invoice` interface, which is a simplified subset of **Peppol BIS Billing 3.0** (European standard EN 16931). All AI output must map to this type.

`src/lib/validator.ts` runs four deterministic checks against every extracted `Invoice`:
1. **Required field presence** — list defined in `src/lib/schema.ts → REQUIRED_FIELDS`
2. **Format validation** — ISO 4217 currency, ISO 8601 dates, ISO 3166-1 alpha-2 country codes, UNTDID 1001 type codes
3. **Math consistency** — `sum(lineItems.lineExtensionAmount) + sum(taxSubtotals.taxAmount)` must equal `totals.payableAmount` within ±0.02
4. **Confidence gating** — any field with a model confidence score below `CONFIDENCE_THRESHOLD` (0.85) is added to `ValidationResult.flaggedFields` and surfaced in `FieldEditor` for human correction

`ValidationResult.valid` is `true` only when there are zero issues of kinds `math_mismatch`, `missing_required`, or `invalid_format` — `low_confidence` warnings do not block the valid flag.

### What is still pending (PoC scaffold)

The following files are not yet implemented:
- `src/components/ResultPanel.tsx` — invoice data display + export button
- `src/hooks/useModel.ts` — model load state machine + progress tracking
- `src/hooks/useInference.ts` — sends image to worker, streams tokens back
- `src/workers/inference.worker.ts` — Transformers.js pipeline inside Web Worker
- `src/App.tsx` and `src/main.tsx` — top-level layout and React root
